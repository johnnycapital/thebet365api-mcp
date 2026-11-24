// Offline tests of the JSON-RPC loop with a mocked upstream; nothing touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer, KEYED_TOOLS, KEYLESS_TOOLS } from "../src/server.js";

const UPSTREAM_TOOLS = [...KEYLESS_TOOLS, ...KEYED_TOOLS, "list_watchlists", "create_watchlists", "answer_onboarding"].map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } }));

function mockUpstream() {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (body.method === "tools/list") return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: UPSTREAM_TOOLS } }), { status: 200 });
    if (body.method === "tools/call") {
      const text = JSON.stringify({ echoed: body.params });
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }], isError: false } })}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "nope" } }));
  };
  fetch.calls = calls;
  return fetch;
}
const names = (reply) => reply.result.tools.map((t) => t.name).sort();

test("initialize negotiates the protocol and declares tools", async () => {
  const s = createServer({ fetch: mockUpstream() });
  const r = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.result.serverInfo.name, "thebet365api-mcp");
  const unknown = await s.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(unknown.result.protocolVersion, "2025-06-18");
});

test("notifications get no reply, ping gets {}, unknown methods get -32601", async () => {
  const s = createServer({ fetch: mockUpstream() });
  assert.equal(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
  assert.deepEqual(await s.handle({ jsonrpc: "2.0", id: 3, method: "ping" }), { jsonrpc: "2.0", id: 3, result: {} });
  assert.equal((await s.handle({ jsonrpc: "2.0", id: 4, method: "sampling/createMessage" })).error.code, -32601);
  assert.equal((await s.handle({ foo: 1 })).error.code, -32600);
});

test("without a key only keyless tools are listed and no Authorization is sent", async () => {
  const f = mockUpstream();
  const s = createServer({ apiKey: "", fetch: f });
  assert.deepEqual(names(await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })), [...KEYLESS_TOOLS].sort());
  assert.equal(f.calls[0].headers.Authorization, undefined);
  const denied = await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_bet365_odds", arguments: { league: "nba" } } });
  assert.equal(denied.error.code, -32602);
  assert.match(denied.error.message, /THEBET365API_KEY/);
});

test("with a key the keyed data tools appear and calls carry the Bearer header", async () => {
  const f = mockUpstream();
  const s = createServer({ apiKey: "bt_test", fetch: f });
  assert.deepEqual(names(await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })), [...KEYLESS_TOOLS, ...KEYED_TOOLS].sort());
  const r = await s.handle({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_bet365_odds", arguments: { league: "nba", user_request: "check" } } });
  assert.equal(r.id, 9);
  assert.deepEqual(JSON.parse(r.result.content[0].text), { echoed: { name: "get_bet365_odds", arguments: { league: "nba", user_request: "check" } } });
  assert.equal(f.calls.at(-1).headers.Authorization, "Bearer bt_test");
  assert.equal(f.calls.at(-1).url, "https://thebet365api.com/api/mcp");
});

test("toolsMode all exposes every upstream tool", async () => {
  const s = createServer({ apiKey: "bt_test", fetch: mockUpstream(), toolsMode: "all" });
  assert.equal((await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools.length, UPSTREAM_TOOLS.length);
});

test("preview is proxied to the hosted keyless tool", async () => {
  const f = mockUpstream();
  const s = createServer({ fetch: f });
  const r = await s.handle({ jsonrpc: "2.0", id: "a", method: "tools/call", params: { name: "preview_bet365_odds", arguments: { league: "nba" } } });
  assert.equal(r.id, "a");
  assert.deepEqual(f.calls[0].body.params, { name: "preview_bet365_odds", arguments: { league: "nba" } });
});

test("upstream down: tools/list falls back to the keyless tools, tools/call returns isError", async () => {
  const s = createServer({ fetch: async () => { throw new Error("connect ECONNREFUSED"); } });
  assert.deepEqual(names(await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })), ["get_bet365_coverage", "preview_bet365_odds"]);
  const r = await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "preview_bet365_odds", arguments: {} } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /could not be reached/);
});

test("batches are answered as arrays", async () => {
  const s = createServer({ fetch: mockUpstream() });
  const r = await s.handle([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "ping" }]);
  assert.deepEqual(r.map((x) => x.id), [1, 2]);
});

test("the bin speaks newline-delimited JSON-RPC over stdio", async () => {
  const http = createHttpServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const result = body.method === "tools/list" ? { tools: UPSTREAM_TOOLS } : { content: [{ type: "text", text: '{"data":[]}' }], isError: false };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${http.address().port}/api/mcp`;
  const bin = fileURLToPath(new URL("../bin/thebet365api-mcp.js", import.meta.url));
  const child = spawn(process.execPath, [bin], { env: { ...process.env, THEBET365API_KEY: "", THEBET365API_MCP_URL: url }, stdio: ["pipe", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", (c) => (out += c));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "preview_bet365_odds", arguments: {} } }) + "\n");
  child.stdin.write("not json\n");
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
  http.close();
  const replies = out.trim().split("\n").map((l) => JSON.parse(l));
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
  assert.equal(replies.length, 4);
  assert.equal(byId[1].result.serverInfo.name, "thebet365api-mcp");
  assert.deepEqual(byId[2].result.tools.map((t) => t.name).sort(), [...KEYLESS_TOOLS].sort());
  assert.equal(byId[3].result.isError, false);
  assert.equal(byId.null.error.code, -32700);
});
