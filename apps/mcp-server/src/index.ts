import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient, readEnvConfig } from "./httpClient.js";
import { readTools } from "./tools/read.js";
import { writeTools } from "./tools/write.js";
import type { ToolDef } from "./tools/types.js";

// stdio is the MCP protocol channel: this process must never write to stdout.
// All diagnostics go to stderr. Transport wiring lives only here so a future
// Streamable HTTP transport swaps in without touching the tools.

async function main(): Promise<void> {
  const cfg = readEnvConfig();
  const api = createApiClient(cfg);

  const server = new McpServer({ name: "rentular", version: "0.1.0" });

  const tools: ToolDef[] = [...readTools, ...writeTools];
  for (const def of tools) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      // The SDK passes validated args; relay them plus the shared client.
      (args: Record<string, unknown>) =>
        def.handler(args as Parameters<typeof def.handler>[0], api),
    );
  }

  await server.connect(new StdioServerTransport());
  console.error("[rentular-mcp] connected over stdio");
}

main().catch((err) => {
  console.error(
    `[rentular-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
