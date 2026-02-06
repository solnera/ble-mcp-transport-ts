export declare class Framer {
    private buffer;
    private totalLength;
    private inProgress;
    private expectedSeq;
    feed(packet: Uint8Array): string | null;
    private reset;
}
export interface PacketizeResult {
    packets: Uint8Array[];
    maxPayload: number;
}
export declare function computeMaxPayload(mtu: number, maxGattValueLen?: number, minPayload?: number): number;
export declare function packetizeJson(message: string, maxPayload: number): PacketizeResult;
