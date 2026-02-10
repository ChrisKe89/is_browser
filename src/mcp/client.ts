// Placeholder MCP integration point.
// The current runner uses Playwright directly. If you want to drive this
// via an MCP host, wire your MCP client to invoke the scripts in this repo.

export type McpConfig = {
  enabled: boolean;
  serverCommand?: string;
};

export function readMcpConfig(): McpConfig {
  const enabled = (process.env.MCP_ENABLED ?? "false").toLowerCase() === "true";
  const serverCommand = process.env.MCP_SERVER_CMD;
  return { enabled, serverCommand };
}
