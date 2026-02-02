import {
  TYPE_SINGLE,
  TYPE_START,
  TYPE_CONT,
  TYPE_END,
  HEADER_TYPE_MASK,
  HEADER_SEQ_MASK,
  ATT_OVERHEAD,
  MIN_PAYLOAD,
  MAX_GATT_VALUE_LEN,
} from "./constants.js";

export class Framer {
  private buffer: Uint8Array = new Uint8Array(0);
  private totalLength = 0;
  private inProgress = false;
  private expectedSeq = 0;

  feed(packet: Uint8Array): string | null {
    if (packet.length === 0) {
      return null;
    }

    const header = packet[0];
    const packetType = header & HEADER_TYPE_MASK;
    const seqId = header & HEADER_SEQ_MASK;
    const payload = packet.slice(1);

    if (packetType === TYPE_SINGLE) {
      return new TextDecoder().decode(payload);
    }

    if (packetType === TYPE_START) {
      if (payload.length < 4) {
        this.reset();
        return null;
      }
      const dataView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      this.totalLength = dataView.getUint32(0, false);
      this.buffer = payload.slice(4);
      this.inProgress = true;
      this.expectedSeq = (seqId + 1) & HEADER_SEQ_MASK;
      return null;
    }

    if (!this.inProgress) {
      return null;
    }

    if (seqId !== this.expectedSeq) {
      this.reset();
      return null;
    }
    this.expectedSeq = (this.expectedSeq + 1) & HEADER_SEQ_MASK;

    if (packetType === TYPE_CONT) {
      const newBuffer = new Uint8Array(this.buffer.length + payload.length);
      newBuffer.set(this.buffer);
      newBuffer.set(payload, this.buffer.length);
      this.buffer = newBuffer;
      return null;
    }

    if (packetType === TYPE_END) {
      const newBuffer = new Uint8Array(this.buffer.length + payload.length);
      newBuffer.set(this.buffer);
      newBuffer.set(payload, this.buffer.length);
      this.buffer = newBuffer;

      if (this.buffer.length !== this.totalLength) {
        this.reset();
        return null;
      }

      const message = new TextDecoder().decode(this.buffer);
      this.reset();
      return message;
    }

    return null;
  }

  private reset(): void {
    this.buffer = new Uint8Array(0);
    this.totalLength = 0;
    this.inProgress = false;
    this.expectedSeq = 0;
  }
}

export interface PacketizeResult {
  packets: Uint8Array[];
  maxPayload: number;
}

export function computeMaxPayload(
  mtu: number,
  maxGattValueLen: number = MAX_GATT_VALUE_LEN,
  minPayload: number = MIN_PAYLOAD
): number {
  let maxPayload = mtu - ATT_OVERHEAD;
  if (maxPayload < minPayload) {
    maxPayload = minPayload;
  }
  if (maxPayload > maxGattValueLen) {
    maxPayload = maxGattValueLen;
  }
  return maxPayload;
}

export function packetizeJson(message: string, maxPayload: number): PacketizeResult {
  const data = new TextEncoder().encode(message);
  const totalLen = data.length;

  if (totalLen + 1 <= maxPayload) {
    const packet = new Uint8Array(1 + totalLen);
    packet[0] = TYPE_SINGLE | 0;
    packet.set(data, 1);
    return { packets: [packet], maxPayload };
  }

  if (maxPayload <= 5) {
    throw new Error("MTU too small");
  }

  const packets: Uint8Array[] = [];
  let offset = 0;
  let seq = 0;

  const startChunkSize = maxPayload - 5;
  const startChunk = data.slice(offset, offset + startChunkSize);
  const startPacket = new Uint8Array(1 + 4 + startChunk.length);
  startPacket[0] = TYPE_START | (seq & HEADER_SEQ_MASK);
  const totalLenView = new DataView(startPacket.buffer, startPacket.byteOffset + 1, 4);
  totalLenView.setUint32(0, totalLen, false);
  startPacket.set(startChunk, 5);
  packets.push(startPacket);
  offset += startChunk.length;
  seq = (seq + 1) & 0xff;

  const contChunkSize = maxPayload - 1;
  while (offset < totalLen) {
    const remaining = totalLen - offset;
    if (remaining > contChunkSize) {
      const chunk = data.slice(offset, offset + contChunkSize);
      const packet = new Uint8Array(1 + chunk.length);
      packet[0] = TYPE_CONT | (seq & HEADER_SEQ_MASK);
      packet.set(chunk, 1);
      packets.push(packet);
      offset += chunk.length;
    } else {
      const chunk = data.slice(offset, offset + remaining);
      const packet = new Uint8Array(1 + chunk.length);
      packet[0] = TYPE_END | (seq & HEADER_SEQ_MASK);
      packet.set(chunk, 1);
      packets.push(packet);
      offset += chunk.length;
    }
    seq = (seq + 1) & 0xff;
  }

  return { packets, maxPayload };
}
