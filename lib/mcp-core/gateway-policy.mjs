import path from "node:path";

// A static MCP bearer proves access to the gateway, not ownership of a Metis
// run. Only these audited tools are available to HTTP clients without a
// signed, scoped Metis session while remote administration is disabled.
const RAW_HTTP_BEARER_TOOL_ALLOWLIST = new Set([
  "gateway_bootstrap",
  "web_search",
  "context7_resolve",
  "context7_query",
]);

export const HOST_ONLY_MCP_IDS = new Set(["github", "filesystem", "jarvis-mk3"]);

export function jarvisBridgeRegistryEntry(root) {
  return {
    id: "jarvis-mk3",
    name: "Jarvis Mk3 local bridge",
    kind: "stdio",
    command: "node",
    args: [path.join(root, "lib/mcp-core/jarvis-bridge.mjs")],
    enabled: false,
    tags: ["jarvis", "local", "host-admin"],
    note: "Enable after the Jarvis Mk3 bridge is configured on the Linux host.",
  };
}

export function rawHttpBearerToolAllowed(name, context = {}, allowRemoteAdmin = false) {
  if (context.transport !== "http" || context.trustedInternal === true || allowRemoteAdmin) {
    return true;
  }
  return RAW_HTTP_BEARER_TOOL_ALLOWLIST.has(name);
}

export function assertRawHttpBearerToolAllowed(name, context = {}, allowRemoteAdmin = false) {
  if (!rawHttpBearerToolAllowed(name, context, allowRemoteAdmin)) {
    throw new Error(
      `${name} is disabled for remote MCP clients. Set MCP_ALLOW_REMOTE_ADMIN=true only in a trusted deployment.`,
    );
  }
}

export function isHostAdminContext(context = {}, localHostAdmin = false) {
  return context.isHostAdmin === true || (!context.userId && localHostAdmin);
}

export function assertHostOnlyMcpMutationAllowed(id, context = {}, localHostAdmin = false) {
  if (HOST_ONLY_MCP_IDS.has(id) && !isHostAdminContext(context, localHostAdmin)) {
    throw new Error(`${id} is reserved for a host administrator.`);
  }
}

export function assertMcpServerMutationAllowed(entry, context = {}, localHostAdmin = false) {
  assertHostOnlyMcpMutationAllowed(entry.id, context, localHostAdmin);
  if (isHostAdminContext(context, localHostAdmin)) return;
  if (entry.kind === "stdio") {
    throw new Error("Local stdio MCP servers require a host administrator.");
  }
  if (!entry.ownerId) {
    throw new Error(`${entry.id} is a shared MCP server and requires a host administrator.`);
  }
  if (entry.ownerId !== context.userId) {
    throw new Error(`${entry.id} is owned by another account.`);
  }
}
