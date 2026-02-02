export { BleTransport, type BleTransportOptions } from "./transport.js";
export { Framer, computeMaxPayload, packetizeJson, type PacketizeResult } from "./framing.js";
export {
  SERVICE_UUID,
  RX_CHAR_UUID,
  TX_CHAR_UUID,
  TYPE_SINGLE,
  TYPE_START,
  TYPE_CONT,
  TYPE_END,
  HEADER_TYPE_MASK,
  HEADER_SEQ_MASK,
  MAX_GATT_VALUE_LEN,
} from "./constants.js";
