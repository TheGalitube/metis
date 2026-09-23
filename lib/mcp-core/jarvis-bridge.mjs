import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "http://127.0.0.1:3213";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const JARVIS_BRIDGE_TOOLS = [
  {
    name: "jarvis_status",
    description: "Read the health of the separate Jarvis Mk3 core.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "jarvis_submit_task",
    description: "Submit a task to Jarvis Mk3. Jarvis executes it separately; required approvals must be decided in Jarvis itself.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", minLength: 1, maxLength: 16000 },
        conversation: { type: "string", minLength: 1, maxLength: 100, description: "Jarvis conversation name; defaults to metis." },
        idempotency_key: { type: "string", minLength: 1, maxLength: 100, description: "Reuse the same key when retrying an uncertain submission." },
      },
      required: ["goal"],
      additionalProperties: false,
    },
  },
  {
    name: "jarvis_task_status",
    description: "Read one Jarvis Mk3 task by ID, including whether it awaits approval in Jarvis.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", pattern: UUID.source } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function privateHost(hostname) {
  if (hostname === "localhost") return "127.0.0.1";
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const family = isIP(host);
  if (family === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return host;
  }
  if (family === 6 && (host === "::1" || /^(fc|fd)[0-9a-f]{2}:/i.test(host))) return host;
  throw new Error("JARVIS_BRIDGE_URL must use localhost or a private IP address");
}

export function bridgeBaseUrl(value = DEFAULT_URL) {
  let url;
  try { url = new URL(String(value)); }
  catch { throw new Error("JARVIS_BRIDGE_URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("JARVIS_BRIDGE_URL must be an HTTP(S) origin without credentials or a path");
  }
  url.hostname = privateHost(url.hostname.toLowerCase());
  return url;
}

function bridgeConfiguration(env) {
  if (!enabled(env.JARVIS_BRIDGE_ENABLED)) throw new Error("Jarvis bridge is disabled");
  const url = bridgeBaseUrl(env.JARVIS_BRIDGE_URL?.trim() || DEFAULT_URL);
  const token = String(env.JARVIS_BRIDGE_TOKEN || "");
  const tokenFile = String(env.JARVIS_BRIDGE_TOKEN_FILE || "").trim();
  if (Boolean(token) === Boolean(tokenFile)) {
    throw new Error("Configure exactly one of JARVIS_BRIDGE_TOKEN or JARVIS_BRIDGE_TOKEN_FILE");
  }
  if (tokenFile && !path.isAbsolute(tokenFile)) {
    throw new Error("JARVIS_BRIDGE_TOKEN_FILE must be an absolute path");
  }
  const rawTimeout = env.JARVIS_BRIDGE_TIMEOUT_MS;
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("JARVIS_BRIDGE_TIMEOUT_MS must be between 100 and 10000");
  }
  return { url, token, tokenFile, timeoutMs };
}

async function resolveToken(config, fileOps) {
  let token = config.token;
  if (config.tokenFile) {
    const info = await fileOps.stat(config.tokenFile);
    if (!info.isFile()) throw new Error("JARVIS_BRIDGE_TOKEN_FILE must be a regular file");
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      throw new Error("JARVIS_BRIDGE_TOKEN_FILE must not be readable by group or others");
    }
    token = (await fileOps.readFile(config.tokenFile, "utf8")).trim();
  }
  if (token.length < 32 || /[\x00-\x20\x7f]/.test(token)) {
    throw new Error("Jarvis bridge token must have at least 32 non-whitespace characters");
  }
  return token;
}

async function boundedJson(response) {
  const claimed = Number(response.headers.get("content-length"));
  if (Number.isFinite(claimed) && claimed > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Jarvis response is too large");
  }
  if (!response.body) throw new Error("Jarvis returned an empty response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Jarvis response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new Error("Jarvis returned invalid JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Jarvis returned an invalid object");
  }
  return payload;
}

function taskSummary(task, includeResult) {
  if (!UUID.test(String(task.id || "")) || typeof task.status !== "string") {
    throw new Error("Jarvis returned an invalid task");
  }
  const status = task.status;
  return {
    id: task.id,
    status,
    ...(typeof task.conversation === "string" ? { conversation: task.conversation } : {}),
    ...(typeof task.created === "number" ? { created: task.created } : {}),
    ...(typeof task.updated === "number" ? { updated: task.updated } : {}),
    ...(includeResult && typeof task.result === "string" ? { result: task.result.slice(0, 32_000) } : {}),
    ...(includeResult && typeof task.error === "string" ? { error: task.error.slice(0, 4_000) } : {}),
    approval_required: status === "waiting_for_approval",
    ...(status === "waiting_for_approval" ? { next_step: "Decide the approval in Jarvis; this bridge cannot approve it." } : {}),
  };
}

function toolResult(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

export async function createJarvisBridge({
  env = process.env,
  fetchImpl = globalThis.fetch,
  fileOps = { readFile, stat },
} = {}) {
  const config = bridgeConfiguration(env);
  const token = await resolveToken(config, fileOps);
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable");

  async function request(route, method = "GET", payload, idempotencyKey) {
    const body = payload ? JSON.stringify(payload) : undefined;
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    };
    let response;
    const signal = AbortSignal.timeout(config.timeoutMs);
    try {
      response = await fetchImpl(new URL(route, config.url), {
        method, headers, body, signal, redirect: "error", cache: "no-store",
      });
    } catch {
      throw new Error(signal.aborted ? "Jarvis request timed out" : "Jarvis core is unavailable");
    }
    if (!response.ok) {
      if (response.status === 401) throw new Error("Jarvis rejected the bridge token (HTTP 401)");
      throw new Error(`Jarvis returned HTTP ${response.status}`);
    }
    return boundedJson(response);
  }

  async function callTool(name, args = {}) {
    try {
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool arguments");
      if (name === "jarvis_status") {
        if (Object.keys(args).length) throw new Error("jarvis_status takes no arguments");
        const health = await request("/healthz");
        return toolResult({ status: health.status, service: health.service, version: health.version });
      }
      if (name === "jarvis_submit_task") {
        if (Object.keys(args).some((key) => !["goal", "conversation", "idempotency_key"].includes(key))) {
          throw new Error("Unsupported task argument");
        }
        const goal = typeof args.goal === "string" ? args.goal.trim() : "";
        const conversation = args.conversation === undefined ? "metis" : args.conversation;
        const idempotencyKey = args.idempotency_key;
        if (!goal || goal.length > 16_000) throw new Error("goal must contain 1 to 16000 characters");
        if (typeof conversation !== "string" || !conversation.trim() || conversation.length > 100) {
          throw new Error("conversation must contain 1 to 100 characters");
        }
        if (idempotencyKey !== undefined &&
            (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(idempotencyKey))) {
          throw new Error("idempotency_key must contain 1 to 100 safe characters");
        }
        const task = await request("/api/tasks", "POST", { goal, conversation }, idempotencyKey);
        return toolResult(taskSummary(task, false));
      }
      if (name === "jarvis_task_status") {
        if (Object.keys(args).some((key) => key !== "id") || !UUID.test(String(args.id || ""))) {
          throw new Error("id must be a Jarvis task UUID");
        }
        const task = await request(`/api/tasks/${args.id}`);
        return toolResult(taskSummary(task, true));
      }
      throw new Error("Unknown Jarvis bridge tool");
    } catch (error) {
      return toolResult({ error: error instanceof Error ? error.message : "Jarvis bridge failed" }, true);
    }
  }

  return { tools: JARVIS_BRIDGE_TOOLS, callTool };
}

async function main() {
  const bridge = await createJarvisBridge();
  const { Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema } =
    await import("./sdk-runtime.mjs").then((module) => module.loadMcpSdk());
  const server = new Server({ name: "jarvis-mk3-bridge", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: bridge.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    bridge.callTool(request.params.name, request.params.arguments || {}));
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Jarvis bridge failed to start");
    process.exitCode = 1;
  });
}
