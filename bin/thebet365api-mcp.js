#!/usr/bin/env node
// stdio MCP server for thebet365api.com. Usage: npx -y github:johnnycapital/thebet365api-mcp
// Env: THEBET365API_KEY (optional; enables the data tools), THEBET365API_MCP_URL (override the hosted endpoint),
// THEBET365API_MCP_TOOLS=all (expose every hosted tool, including watchlists).
import { serveStdio, VERSION } from "../src/server.js";

if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.stdout.write("thebet365api-mcp: stdio MCP server for thebet365api.com. Coverage and a delayed preview need no key; set THEBET365API_KEY for current odds, events and line history.\n");
  process.exit(0);
}

const { done } = serveStdio({
  apiKey: process.env.THEBET365API_KEY ?? "",
  upstream: process.env.THEBET365API_MCP_URL || undefined,
  toolsMode: process.env.THEBET365API_MCP_TOOLS === "all" ? "all" : "default",
});
done.then(() => process.exit(0));
