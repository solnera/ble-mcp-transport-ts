import noble from "@abandonware/noble";
import { Framer, computeMaxPayload, packetizeJson } from "./framing.js";
import { SERVICE_UUID, RX_CHAR_UUID, TX_CHAR_UUID } from "./constants.js";
export class BleTransport {
    serviceUuid;
    rxCharUuid;
    txCharUuid;
    namePrefix;
    scanTimeout;
    peripheral = null;
    rxCharacteristic = null;
    txCharacteristic = null;
    framer = new Framer();
    currentMtu = 23;
    started = false;
    discovering = false;
    sessionId;
    onclose;
    onerror;
    onmessage;
    constructor(options = {}) {
        this.serviceUuid = (options.serviceUuid ?? SERVICE_UUID).toLowerCase().replace(/-/g, "");
        this.rxCharUuid = (options.rxCharUuid ?? RX_CHAR_UUID).toLowerCase().replace(/-/g, "");
        this.txCharUuid = (options.txCharUuid ?? TX_CHAR_UUID).toLowerCase().replace(/-/g, "");
        this.namePrefix = options.namePrefix;
        this.scanTimeout = options.scanTimeout ?? 10000;
    }
    async start() {
        if (this.started) {
            return;
        }
        try {
            await this.waitForPowerOn();
            await this.discoverDevice();
            await this.connectDevice();
            await this.setupCharacteristics();
            this.started = true;
            this.sessionId = crypto.randomUUID();
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.onerror?.(err);
            throw err;
        }
    }
    async send(message, _options) {
        if (!this.started || !this.rxCharacteristic) {
            throw new Error("Transport not started");
        }
        try {
            const json = JSON.stringify(message);
            const maxPayload = computeMaxPayload(this.currentMtu);
            const { packets } = packetizeJson(json, maxPayload);
            for (const packet of packets) {
                await this.writeCharacteristic(this.rxCharacteristic, Buffer.from(packet));
            }
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.onerror?.(err);
            throw err;
        }
    }
    async close() {
        if (!this.started) {
            return;
        }
        try {
            if (this.peripheral) {
                await this.disconnectPeripheral();
            }
            this.cleanup();
            this.onclose?.();
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.onerror?.(err);
        }
    }
    setProtocolVersion(_version) {
        // Protocol version is informational only
    }
    waitForPowerOn() {
        return new Promise((resolve, reject) => {
            if (noble._state === "poweredOn") {
                resolve();
                return;
            }
            const timeout = setTimeout(() => {
                noble.removeListener("stateChange", onStateChange);
                reject(new Error("Bluetooth adapter timeout"));
            }, 5000);
            const onStateChange = (state) => {
                if (state === "poweredOn") {
                    clearTimeout(timeout);
                    noble.removeListener("stateChange", onStateChange);
                    resolve();
                }
            };
            noble.on("stateChange", onStateChange);
        });
    }
    discoverDevice() {
        return new Promise((resolve, reject) => {
            if (this.discovering) {
                reject(new Error("Already discovering"));
                return;
            }
            this.discovering = true;
            const timeout = setTimeout(() => {
                noble.stopScanning();
                noble.removeListener("discover", onDiscover);
                this.discovering = false;
                reject(new Error("BLE device discovery timeout"));
            }, this.scanTimeout);
            const onDiscover = (peripheral) => {
                const advertisedServices = peripheral.advertisement.serviceUuids || [];
                const matchesService = advertisedServices.some((uuid) => uuid.toLowerCase().replace(/-/g, "") === this.serviceUuid);
                if (!matchesService) {
                    return;
                }
                if (this.namePrefix && !peripheral.advertisement.localName?.startsWith(this.namePrefix)) {
                    return;
                }
                clearTimeout(timeout);
                noble.stopScanning();
                noble.removeListener("discover", onDiscover);
                this.discovering = false;
                this.peripheral = peripheral;
                resolve();
            };
            noble.on("discover", onDiscover);
            noble.startScanning([], false);
        });
    }
    connectDevice() {
        return new Promise((resolve, reject) => {
            if (!this.peripheral) {
                reject(new Error("No peripheral found"));
                return;
            }
            const peripheral = this.peripheral;
            peripheral.once("connect", () => {
                resolve();
            });
            peripheral.once("disconnect", () => {
                this.handleDisconnect();
            });
            peripheral.connect((error) => {
                if (error) {
                    reject(error);
                }
            });
        });
    }
    async setupCharacteristics() {
        if (!this.peripheral) {
            throw new Error("No peripheral connected");
        }
        const { services, characteristics } = await this.discoverServices();
        const service = services.find((s) => s.uuid.toLowerCase().replace(/-/g, "") === this.serviceUuid);
        if (!service) {
            throw new Error("Service not found");
        }
        this.rxCharacteristic = characteristics.find((c) => c.uuid.toLowerCase().replace(/-/g, "") === this.rxCharUuid) || null;
        this.txCharacteristic = characteristics.find((c) => c.uuid.toLowerCase().replace(/-/g, "") === this.txCharUuid) || null;
        if (!this.rxCharacteristic || !this.txCharacteristic) {
            throw new Error("Required characteristics not found");
        }
        await this.subscribeCharacteristic(this.txCharacteristic);
        if (this.peripheral.mtu) {
            this.currentMtu = this.peripheral.mtu;
        }
    }
    discoverServices() {
        return new Promise((resolve, reject) => {
            if (!this.peripheral) {
                reject(new Error("No peripheral"));
                return;
            }
            this.peripheral.discoverAllServicesAndCharacteristics((error, services, characteristics) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve({ services: services || [], characteristics: characteristics || [] });
                }
            });
        });
    }
    subscribeCharacteristic(characteristic) {
        return new Promise((resolve, reject) => {
            characteristic.on("data", (data) => {
                this.handleNotification(data);
            });
            characteristic.subscribe((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
    writeCharacteristic(characteristic, data) {
        return new Promise((resolve, reject) => {
            characteristic.write(data, true, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
    disconnectPeripheral() {
        return new Promise((resolve) => {
            if (!this.peripheral) {
                resolve();
                return;
            }
            this.peripheral.disconnect(() => {
                resolve();
            });
        });
    }
    handleNotification(data) {
        try {
            const packet = new Uint8Array(data);
            const messageJson = this.framer.feed(packet);
            if (messageJson) {
                const message = JSON.parse(messageJson);
                this.onmessage?.(message);
            }
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.onerror?.(err);
        }
    }
    handleDisconnect() {
        this.cleanup();
        this.onclose?.();
    }
    cleanup() {
        this.started = false;
        this.peripheral = null;
        this.rxCharacteristic = null;
        this.txCharacteristic = null;
        this.framer = new Framer();
    }
}
