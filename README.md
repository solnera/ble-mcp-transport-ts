# BLE MCP Transport

A Node.js BLE transport that enables MCP clients to communicate with MCP devices over BLE GATT. It relies on @abandonware/noble for scanning, connecting, and characteristic I/O, and includes JSON-RPC message framing for MTU-constrained links.

## Features

- Scan and connect to peripherals by service UUID
- Bidirectional messaging via RX/TX characteristics
- Message packetization and reassembly for large payloads
- Compatible with the @modelcontextprotocol/sdk Transport interface

## Quick Start

### Install
```bash
npm install ble-mcp-transport
```

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { BleTransport } from "ble-mcp-transport";

const transport = new BleTransport({
  scanTimeout: 10000,
});

const client = new Client(
  { name: "ble-mcp-client", version: "1.0.0" },
  { capabilities: {} }
);

await client.connect(transport);
const tools = await client.listTools();
console.log(tools);
```

## Transport Options

`BleTransport` supports these optional settings:

- `serviceUuid`: Service UUID (defaults to the built-in value)
- `rxCharUuid`: RX characteristic UUID (defaults to the built-in value)
- `txCharUuid`: TX characteristic UUID (defaults to the built-in value)
- `namePrefix`: Peripheral name prefix filter
- `scanTimeout`: Scan timeout in milliseconds (default 10000)

Built-in UUIDs:

- Service: `00001999-0000-1000-8000-00805f9b34fb`
- RX: `4963505f-5258-4000-8000-00805f9b34fb`
- TX: `4963505f-5458-4000-8000-00805f9b34fb`

## Protocol and Framing

- Uses BLE GATT for communication
- RX characteristic: client writes messages
- TX characteristic: server notifies messages
- Start packet includes total length; subsequent packets increment sequence
- JSON-RPC messages are emitted after full reassembly

## Development

```bash
npm run build
```

## Requirements

- Node.js runtime
- A BLE adapter and appropriate OS permissions
