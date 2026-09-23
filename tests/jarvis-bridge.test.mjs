import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bridgeBaseUrl,
  createJarvisBridge,
  JARVIS_BRIDGE_TOOLS,
} from "../lib/mcp-core/jarvis-bridge.mjs";

const TOKEN = "test-token-with-more-than-thirty-two-characters";
const TASK_ID = "123e4567-e89b-42d3-a456-426614174000";
const config = (overrides = {}) => ({
  JARVIS_BRIDGE_ENABLED: "true",
  JARVIS_BRIDGE_URL: "http://127.0.0.1:3213",
  JARVIS_BRIDGE_TOKEN: TOKEN,
  ...overrides,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const parsed = (result) => JSON.parse(result.content[0].text);

test("bridge is off by default and rejects public or ambiguous destinations", async () => {
  await assert.rejects(createJarvisBridge({ env: { JARVIS_BRIDGE_TOKEN: TOKEN } }), /disabled/);
  for (const url of [
    "http://example.com:3213",
    "http://8.8.8.8:3213",
    "http://169.254.169.254:3213",
    "http://user:pass@127.0.0.1:3213",
    "http://127.0.0.1:3213/api/tasks",
    "http://127.0.0.1:3213/?next=https://example.com",
  ]) {
    assert.throws(() => bridgeBaseUrl(url));
  }
  assert.equal(bridgeBaseUrl("http://localhost:3213").href, "http://127.0.0.1:3213/");
  assert.equal(bridgeBaseUrl("http://10.2.3.4:3213").href, "http://10.2.3.4:3213/");
  assert.equal(bridgeBaseUrl("http://[fd12::1]:3213").href, "http://[fd12::1]:3213/");
});

test("only status, task submit and task status are exposed", async () => {
  assert.deepEqual(JARVIS_BRIDGE_TOOLS.map((tool) => tool.name), [
    "jarvis_status", "jarvis_submit_task", "jarvis_task_status",
  ]);
  let called = false;
  const bridge = await createJarvisBridge({
    env: config(),
    fetchImpl: async () => { called = true; return json({}); },
  });
  const approval = await bridge.callTool("jarvis_approve_task", { id: TASK_ID });
  assert.equal(approval.isError, true);
  assert.equal(called, false);
});

test("authenticated Jarvis requests use fixed routes and preserve approval control", async () => {
  const calls = [];
  const bridge = await createJarvisBridge({
    env: config(),
    fetchImpl: async (url, options) => {
      calls.push({ url: url.href, options });
      if (url.pathname === "/healthz") return json({ status: "ok", service: "jarvis-mk3", version: "0.1.0" });
      if (options.method === "POST") return json({ id: TASK_ID, status: "queued", conversation: "metis" }, 202);
      return json({ id: TASK_ID, status: "waiting_for_approval", result: null });
    },
  });
  assert.deepEqual(parsed(await bridge.callTool("jarvis_status")), {
    status: "ok", service: "jarvis-mk3", version: "0.1.0",
  });
  assert.deepEqual(parsed(await bridge.callTool("jarvis_submit_task", {
    goal: "  Check the Linux node  ", idempotency_key: "one-run-1",
  })), {
    id: TASK_ID, status: "queued", conversation: "metis", approval_required: false,
  });
  assert.deepEqual(parsed(await bridge.callTool("jarvis_task_status", { id: TASK_ID })), {
    id: TASK_ID,
    status: "waiting_for_approval",
    approval_required: true,
    next_step: "Decide the approval in Jarvis; this bridge cannot approve it.",
  });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/healthz", "/api/tasks", `/api/tasks/${TASK_ID}`,
  ]);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.cache, "no-store");
    assert.ok(call.options.signal);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    goal: "Check the Linux node", conversation: "metis",
  });
  assert.equal(calls[1].options.headers["Idempotency-Key"], "one-run-1");
  assert.equal(Number(calls[1].options.headers["Content-Length"]), Buffer.byteLength(calls[1].options.body));
});

test("invalid input is rejected before any HTTP request", async () => {
  let calls = 0;
  const bridge = await createJarvisBridge({
    env: config(),
    fetchImpl: async () => { calls++; return json({}); },
  });
  for (const [name, args] of [
    ["jarvis_submit_task", { goal: "   " }],
    ["jarvis_submit_task", { goal: "x", target: "other" }],
    ["jarvis_submit_task", { goal: "x", idempotency_key: "bad\nheader" }],
    ["jarvis_task_status", { id: "../../../api/approvals" }],
  ]) {
    assert.equal((await bridge.callTool(name, args)).isError, true);
  }
  assert.equal(calls, 0);
});

test("HTTP, redirect and oversized responses fail without leaking the token", async () => {
  for (const fetchImpl of [
    async () => json({ detail: TOKEN }, 401),
    async () => { throw new Error(`redirect to https://example.com/?token=${TOKEN}`); },
    async () => new Response("x".repeat(512 * 1024 + 1), { headers: { "Content-Type": "application/json" } }),
  ]) {
    const bridge = await createJarvisBridge({ env: config(), fetchImpl });
    const result = await bridge.callTool("jarvis_status");
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text.includes(TOKEN), false);
  }
});

test("a stalled Jarvis request ends at the configured timeout", async () => {
  const bridge = await createJarvisBridge({
    env: config({ JARVIS_BRIDGE_TIMEOUT_MS: "100" }),
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }),
  });
  const result = await bridge.callTool("jarvis_status");
  assert.equal(result.isError, true);
  assert.match(parsed(result).error, /timed out/);
});

test("token files can be used instead of putting the token in an environment value", async () => {
  let fileRead = false;
  const bridge = await createJarvisBridge({
    env: config({ JARVIS_BRIDGE_TOKEN: "", JARVIS_BRIDGE_TOKEN_FILE: "/run/secrets/jarvis-token" }),
    fileOps: {
      stat: async () => ({ isFile: () => true, mode: 0o100600 }),
      readFile: async () => { fileRead = true; return `${TOKEN}\n`; },
    },
    fetchImpl: async () => json({ status: "ok" }),
  });
  assert.equal(fileRead, true);
  assert.equal(parsed(await bridge.callTool("jarvis_status")).status, "ok");
});
