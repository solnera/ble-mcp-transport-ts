import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { BleTransport } from "../src/index.js";

async function main() {
  const transport = new BleTransport({
    scanTimeout: 1000,
  });

  const client = new Client(
    {
      name: "ble-mcp-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    await client.connect(transport);
    console.log("Connected to BLE MCP Server");

    const tools = await client.listTools();
    console.log("Available tools:", tools);

    // WiFi configuration parameters
    const ssid = "";
    const password = "";

    console.log(`Configuring WiFi: ${ssid}`);
    const result = await client.callTool({ name: "config_wifi", arguments: { ssid, password } });
    console.log("Configuration result:", result);

    await client.close();
    console.log("Connection closed");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
