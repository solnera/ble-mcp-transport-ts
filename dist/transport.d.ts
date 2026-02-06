import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
export interface BleTransportOptions {
    serviceUuid?: string;
    rxCharUuid?: string;
    txCharUuid?: string;
    namePrefix?: string;
    scanTimeout?: number;
}
export declare class BleTransport implements Transport {
    private serviceUuid;
    private rxCharUuid;
    private txCharUuid;
    private namePrefix?;
    private scanTimeout;
    private peripheral;
    private rxCharacteristic;
    private txCharacteristic;
    private framer;
    private currentMtu;
    private started;
    private discovering;
    sessionId?: string;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: <T extends JSONRPCMessage>(message: T) => void;
    constructor(options?: BleTransportOptions);
    start(): Promise<void>;
    send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    setProtocolVersion(_version: string): void;
    private waitForPowerOn;
    private discoverDevice;
    private connectDevice;
    private setupCharacteristics;
    private discoverServices;
    private subscribeCharacteristic;
    private writeCharacteristic;
    private disconnectPeripheral;
    private handleNotification;
    private handleDisconnect;
    private cleanup;
}
