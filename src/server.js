// thebet365api-mcp: a stdio MCP server that forwards to the hosted thebet365api.com MCP server.
// Tool schemas come from the hosted server's tools/list, so they stay in sync with the API.
// Zero dependencies. Independent and unofficial; not affiliated with, endorsed by or sponsored by bet365.

export const VERSION = "0.1.0";
export const DEFAULT_UPSTREAM = "https://thebet365api.com/api/mcp";
export const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** Work with no key. */
export const KEYLESS_TOOLS = ["get_bet365_coverage", "preview_bet365_odds", "get_onboarding_questions", "send_feedback"];
/** Exposed only when THEBET365API_KEY is set. THEBET365API_MCP_TOOLS=all exposes every upstream tool instead (watchlists, onboarding answers). */
export const KEYED_TOOLS = ["get_bet365_odds", "list_bet365_events", "get_bet365_line_history"];

/** Used only when the hosted server cannot be reached for tools/list, so the keyless tools still appear. */
export const FALLBACK_TOOLS = [
  { name: "get_bet365_coverage", description: "Which bet365 leagues and markets are captured, with when collection began and the age of the latest price per league. No key needed.", inputSchema: { type: "object", properties: {} } },
  { name: "preview_bet365_odds", description: "A delayed preview of captured bet365 prices with no API key: moneyline or match result for up to 3 events, 15 minutes behind.", inputSchema: { type: "object", properties: { league: { type: "string", description: "League code, such as nba, nfl, nhl, ncaaf, ncaab, mlb, epl, serie-a, bundesliga, ligue-1 or ucl." } } } },
];

const INSTRUCTIONS = "bet365 odds as JSON from thebet365api.com: US moneyline, spread and total plus European soccer prices, each with observed_at. "
  + "get_bet365_coverage and preview_bet365_odds work with no key. Set THEBET365API_KEY (free at https://thebet365api.com/sign-up, no card) for current odds, events and line history; data tools take user_request, the current task in one sentence. "
  + "Independent and unofficial. Not affiliated with, endorsed by or sponsored by bet365.";

const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

/** The last JSON-RPC message of a Streamable HTTP reply sent as JSON or as server-sent events. */
export function parseRpcBody(text) {
  const t = text.trimStart();
  if (t.startsWith("event:") || t.startsWith("data:")) {
    const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    return JSON.parse(lines[lines.length - 1] ?? "{}");
  }
  return JSON.parse(text);
}

/**
 * createServer({ apiKey, upstream, fetch, toolsMode }) returns { handle(message) }, where handle takes one parsed
 * JSON-RPC message (or a batch array) and resolves to the reply, or undefined for notifications.
 */
export function createServer(options = {}) {
  const apiKey = options.apiKey ?? "";
  const upstream = options.upstream ?? DEFAULT_UPSTREAM;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const toolsMode = options.toolsMode ?? "default";
  const timeoutMs = options.timeoutMs ?? 60000;
  let upstreamId = 0;
  let toolCache = null;

  const exposed = (name) => {
    if (KEYLESS_TOOLS.includes(name)) return true;
    if (!apiKey) return false;
    return toolsMode === "all" || KEYED_TOOLS.includes(name);
  };

  async function forward(method, params) {
    upstreamId += 1;
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": `thebet365api-mcp/${VERSION}` };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(upstream, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: upstreamId, method, params }), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let message;
    try { message = parseRpcBody(text); } catch { throw Object.assign(new Error(`thebet365api.com answered HTTP ${res.status} with a body that is not JSON`), { status: res.status }); }
    if (message && message.error && !message.jsonrpc) throw Object.assign(new Error(message.error.message ?? `HTTP ${res.status}`), { status: res.status, data: message });
    return message;
  }

  async function listTools() {
    if (toolCache) return toolCache;
    try {
      const reply = await forward("tools/list", {});
      const tools = reply?.result?.tools;
      if (!Array.isArray(tools)) throw new Error("no tools in reply");
      toolCache = tools.filter((t) => exposed(t.name));
      return toolCache;
    } catch (error) {
      process.stderr?.write?.(`thebet365api-mcp: tools/list from ${upstream} failed (${error.message}); serving the keyless tools only\n`);
      return FALLBACK_TOOLS;
    }
  }

  async function handleOne(msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return msg && "id" in msg && !("method" in msg) ? undefined : rpcError(msg?.id, -32600, "Invalid Request");
    }
    const isNotification = !("id" in msg) || msg.id === null;
    const { id, method, params = {} } = msg;
    if (isNotification) return undefined;
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return rpcResult(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "thebet365api-mcp", title: "bet365 API (thebet365api.com)", version: VERSION, websiteUrl: "https://thebet365api.com" },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: await listTools() });
      case "tools/call": {
        const name = params?.name;
        if (typeof name !== "string") return rpcError(id, -32602, "tools/call needs params.name");
        if (!exposed(name)) {
          const hint = KEYED_TOOLS.includes(name) || !apiKey ? " Set THEBET365API_KEY (free at https://thebet365api.com/sign-up) to use the data tools." : "";
          return rpcError(id, -32602, `Unknown tool: ${name}.${hint}`);
        }
        try {
          const reply = await forward("tools/call", { name, arguments: params.arguments ?? {} });
          if (reply?.error) return rpcError(id, reply.error.code ?? -32603, reply.error.message ?? "Upstream error", reply.error.data);
          return rpcResult(id, reply?.result ?? { content: [], isError: true });
        } catch (error) {
          return rpcResult(id, { content: [{ type: "text", text: `thebet365api.com could not be reached: ${error.message}` }], isError: true });
        }
      }
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "prompts/list":
        return rpcResult(id, { prompts: [] });
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  async function handle(message) {
    if (Array.isArray(message)) {
      if (message.length === 0) return rpcError(null, -32600, "Invalid Request");
      const replies = (await Promise.all(message.map(handleOne))).filter(Boolean);
      return replies.length ? replies : undefined;
    }
    return handleOne(message);
  }

  return { handle, listTools };
}

/**
 * Serve newline-delimited JSON-RPC on a readable and a writable stream (stdin and stdout by default).
 * Requests are handled concurrently; each reply is one line on stdout. Logs go to stderr only.
 */
export function serveStdio({ input = process.stdin, output = process.stdout, ...options } = {}) {
  const server = createServer(options);
  let buffer = "";
  const pending = new Set();
  const write = (reply) => { if (reply !== undefined) output.write(JSON.stringify(reply) + "\n"); };
  const onLine = (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { write(rpcError(null, -32700, "Parse error")); return; }
    const job = server.handle(msg).then(write, (error) => write(rpcError(msg?.id, -32603, error.message)));
    pending.add(job);
    job.finally(() => pending.delete(job));
  };
  input.setEncoding?.("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      onLine(line);
    }
  });
  const done = new Promise((resolve) => input.on("end", async () => {
    if (buffer.trim()) onLine(buffer);
    await Promise.all([...pending]);
    resolve();
  }));
  return { server, done };
}
