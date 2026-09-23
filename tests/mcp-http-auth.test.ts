import assert from "node:assert/strict";
import test from "node:test";
import { signTrustedMcpSession } from "../lib/mcp-core/session-token.mjs";
// @ts-expect-error extracted helper ships as plain ESM without a checked JS graph
import { corsAllowOrigin, corsAllowedOrigins, requestAuthorization } from "../lib/mcp-core/http-auth.mjs";
import {
  HOST_ONLY_MCP_IDS,
  assertMcpServerMutationAllowed,
  assertRawHttpBearerToolAllowed,
  isHostAdminContext,
  jarvisBridgeRegistryEntry,
  rawHttpBearerToolAllowed,
} from "../lib/mcp-core/gateway-policy.mjs";

const secret = "a".repeat(64);
const now = 1_800_000_000_000;

test("localhost without a bearer is rejected", () => {
  const req = {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.deepEqual(requestAuthorization(req, secret), { ok: false, trustedContext: null });
});

test("static bearer and signed session tokens are accepted", () => {
  const staticReq = { headers: { authorization: `Bearer ${secret}` }, socket: { remoteAddress: "10.0.0.8" } };
  assert.equal(requestAuthorization(staticReq, secret).ok, true);
  assert.equal(requestAuthorization(staticReq, secret).trustedContext, null);

  const token = signTrustedMcpSession({
    v: 1,
    exp: now + 60_000,
    userId: "user-a",
    uid: 1000,
    gid: 1000,
    workspaceRoot: "/tmp",
    home: "/tmp",
    trustedInternal: true,
  }, secret);
  const sessionReq = { headers: { authorization: `Bearer ${token}` }, socket: { remoteAddress: "127.0.0.1" } };
  const auth = requestAuthorization(sessionReq, secret);
  assert.equal(auth.ok, true);
  assert.equal(auth.trustedContext?.userId, "user-a");
});

test("tampered session tokens fail closed instead of localhost anonymous", () => {
  const req = {
    headers: { authorization: "Bearer metis-v1.not-a-token" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(requestAuthorization(req, secret).ok, false);
});

test("CORS does not reflect arbitrary origins", () => {
  const allowed = corsAllowedOrigins({
    internalOrigin: "https://ai.example.com",
    extra: "https://app.example.com",
  });
  assert.equal(corsAllowOrigin("https://ai.example.com", allowed), "https://ai.example.com");
  assert.equal(corsAllowOrigin("https://evil.example", allowed), null);
  assert.equal(corsAllowOrigin("", allowed), null);
});

test("raw HTTP bearer grants only explicitly audited gateway tools", () => {
  const rawHttp = { transport: "http" };
  for (const name of ["gateway_bootstrap", "web_search", "context7_resolve", "context7_query"]) {
    assert.equal(rawHttpBearerToolAllowed(name, rawHttp), true, name);
  }
  for (const name of [
    "execute_command", "verify_work", "write_file", "edit_file", "delete_file",
    "remote_client_terminal", "windows_desktop_job", "workflow_save", "workflow_run",
    "call_mcp_tool", "ensure_capability", "upsert_mcp_server", "set_mcp_server_enabled",
    "get_connection_instructions", "read_file", "unknown_future_tool",
  ]) {
    assert.equal(rawHttpBearerToolAllowed(name, rawHttp), false, name);
    assert.throws(() => assertRawHttpBearerToolAllowed(name, rawHttp), /disabled for remote MCP clients/);
  }
});

test("signed sessions and explicit remote administration retain gateway access", () => {
  assert.equal(rawHttpBearerToolAllowed("verify_work", { transport: "http", trustedInternal: true }), true);
  assert.equal(rawHttpBearerToolAllowed("edit_file", { transport: "stdio" }), true);
  assert.equal(rawHttpBearerToolAllowed("workflow_run", { transport: "http" }, true), true);
});

test("Jarvis bridge is disabled by default and reserved for host admins", () => {
  const bridge = jarvisBridgeRegistryEntry("/srv/metis");
  assert.equal(bridge.id, "jarvis-mk3");
  assert.equal(bridge.kind, "stdio");
  assert.equal(bridge.command, "node");
  assert.equal(bridge.args[0].replaceAll("\\", "/"), "/srv/metis/lib/mcp-core/jarvis-bridge.mjs");
  assert.equal(bridge.enabled, false);
  assert.equal(HOST_ONLY_MCP_IDS.has(bridge.id), true);
  assert.throws(() => assertMcpServerMutationAllowed(bridge, { userId: "member" }), /host administrator/);
  assert.doesNotThrow(() => assertMcpServerMutationAllowed(bridge, { userId: "admin", isHostAdmin: true }));
});

test("non-admins cannot register stdio servers or mutate shared registry entries", () => {
  const member = { userId: "member" };
  assert.equal(isHostAdminContext(member, true), false, "gateway process privilege must not promote a user");
  assert.throws(() => assertMcpServerMutationAllowed({ id: "custom-local", kind: "stdio", ownerId: "member" }, member), /stdio/);
  assert.throws(() => assertMcpServerMutationAllowed({ id: "context7", kind: "remote" }, member), /shared MCP server/);
  assert.throws(() => assertMcpServerMutationAllowed({ id: "personal", kind: "remote", ownerId: "other" }, member), /another account/);
  assert.doesNotThrow(() => assertMcpServerMutationAllowed({ id: "personal", kind: "remote", ownerId: "member" }, member));
});
