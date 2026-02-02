import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import noble from "@abandonware/noble";
import { Framer, computeMaxPayload, packetizeJson } from "./framing.js";
import { SERVICE_UUID, RX_CHAR_UUID, TX_CHAR_UUID } from "./constants.js";

export interface BleTransportOptions {
  serviceUuid?: string;
  rxCharUuid?: string;
  txCharUuid?: string;
  namePrefix?: string;
  scanTimeout?: number;
}

export class BleTransport implements Transport {
  private serviceUuid: string;
  private rxCharUuid: string;
  private txCharUuid: string;
  private namePrefix?: string;
  private scanTimeout: number;

  private peripheral: noble.Peripheral | null = null;
  private rxCharacteristic: noble.Characteristic | null = null;
  private txCharacteristic: noble.Characteristic | null = null;
  private framer = new Framer();
  private currentMtu = 23;
  private started = false;
  private discovering = false;

  public sessionId?: string;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  constructor(options: BleTransportOptions = {}) {
    this.serviceUuid = (options.serviceUuid ?? SERVICE_UUID).toLowerCase().replace(/-/g, "");
    this.rxCharUuid = (options.rxCharUuid ?? RX_CHAR_UUID).toLowerCase().replace(/-/g, "");
    this.txCharUuid = (options.txCharUuid ?? TX_CHAR_UUID).toLowerCase().replace(/-/g, "");
    this.namePrefix = options.namePrefix;
    this.scanTimeout = options.scanTimeout ?? 10000;
  }

  async start(): Promise<void> {
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
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onerror?.(err);
      throw err;
    }
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
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
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onerror?.(err);
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this.started) {
      return;
    }

    try {
      if (this.peripheral) {
        await this.disconnectPeripheral();
      }
      this.cleanup();
      this.onclose?.();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onerror?.(err);
    }
  }

  setProtocolVersion(_version: string): void {
    // Protocol version is informational only
  }

  private waitForPowerOn(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (noble._state === "poweredOn") {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        noble.removeListener("stateChange", onStateChange);
        reject(new Error("Bluetooth adapter timeout"));
      }, 5000);

      const onStateChange = (state: string) => {
        if (state === "poweredOn") {
          clearTimeout(timeout);
          noble.removeListener("stateChange", onStateChange);
          resolve();
        }
      };

      noble.on("stateChange", onStateChange);
    });
  }

  private discoverDevice(): Promise<void> {
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

      const onDiscover = (peripheral: noble.Peripheral) => {
        const advertisedServices = peripheral.advertisement.serviceUuids || [];
        const matchesService = advertisedServices.some(
          (uuid) => uuid.toLowerCase().replace(/-/g, "") === this.serviceUuid
        );

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

  private connectDevice(): Promise<void> {
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

  private async setupCharacteristics(): Promise<void> {
    if (!this.peripheral) {
      throw new Error("No peripheral connected");
    }

    const { services, characteristics } = await this.discoverServices();

    const service = services.find(
      (s) => s.uuid.toLowerCase().replace(/-/g, "") === this.serviceUuid
    );
    if (!service) {
      throw new Error("Service not found");
    }

    this.rxCharacteristic = characteristics.find(
      (c) => c.uuid.toLowerCase().replace(/-/g, "") === this.rxCharUuid
    ) || null;
    this.txCharacteristic = characteristics.find(
      (c) => c.uuid.toLowerCase().replace(/-/g, "") === this.txCharUuid
    ) || null;

    if (!this.rxCharacteristic || !this.txCharacteristic) {
      throw new Error("Required characteristics not found");
    }

    await this.subscribeCharacteristic(this.txCharacteristic);

    if (this.peripheral.mtu) {
      this.currentMtu = this.peripheral.mtu;
    }
  }

  private discoverServices(): Promise<{
    services: noble.Service[];
    characteristics: noble.Characteristic[];
  }> {
    return new Promise((resolve, reject) => {
      if (!this.peripheral) {
        reject(new Error("No peripheral"));
        return;
      }

      this.peripheral.discoverAllServicesAndCharacteristics((error, services, characteristics) => {
        if (error) {
          reject(error);
        } else {
          resolve({ services: services || [], characteristics: characteristics || [] });
        }
      });
    });
  }

  private subscribeCharacteristic(characteristic: noble.Characteristic): Promise<void> {
    return new Promise((resolve, reject) => {
      characteristic.on("data", (data: Buffer) => {
        this.handleNotification(data);
      });

      characteristic.subscribe((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private writeCharacteristic(
    characteristic: noble.Characteristic,
    data: Buffer
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      characteristic.write(data, true, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private disconnectPeripheral(): Promise<void> {
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

  private handleNotification(data: Buffer): void {
    try {
      const packet = new Uint8Array(data);
      const messageJson = this.framer.feed(packet);
      if (messageJson) {
        const message = JSON.parse(messageJson) as JSONRPCMessage;
        this.onmessage?.(message);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onerror?.(err);
    }
  }

  private handleDisconnect(): void {
    this.cleanup();
    this.onclose?.();
  }

  private cleanup(): void {
    this.started = false;
    this.peripheral = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.framer = new Framer();
  }
}
