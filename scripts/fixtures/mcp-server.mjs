/** Deterministic local MCP stdio fixture for native transport initialization, tool discovery and cleanup tests. */
import { createInterface } from "node:readline";
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === "initialize")
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "native-stdio-fixture", version: "1.0.0" },
    };
  else if (request.method === "tools/list")
    result = {
      tools: [
        {
          name: "echo",
          description: "Return fixture input",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
          },
        },
      ],
    };
  else if (request.method === "tools/call")
    result = {
      content: [{ type: "text", text: request.params.arguments.text }],
    };
  else if (request.method === "ping") result = {};
  else {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Method not found" },
      }) + "\n",
    );
    return;
  }
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
  );
});
