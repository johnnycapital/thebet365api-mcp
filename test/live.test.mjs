// Opt-in live test against the hosted server: THEBET365API_LIVE=1 node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

test("live keyless tools/list, coverage and preview", { skip: process.env.THEBET365API_LIVE !== "1" && "set THEBET365API_LIVE=1 to call thebet365api.com" }, async () => {
  const s = createServer({ apiKey: "" });
  const list = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.ok(list.result.tools.some((t) => t.name === "preview_bet365_odds"));
  const cov = await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_bet365_coverage", arguments: {} } });
  assert.equal(cov.result.isError, false);
  const prev = await s.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "preview_bet365_odds", arguments: { league: "nba" } } });
  assert.ok(prev.result.content[0].text.length > 0);
});
