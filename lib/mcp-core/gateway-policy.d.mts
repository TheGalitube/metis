export type GatewayPolicyContext = {
  transport?: string;
  trustedInternal?: boolean;
  userId?: string;
  isHostAdmin?: boolean;
};

export type McpRegistryPolicyEntry = {
  id: string;
  kind?: string;
  ownerId?: string;
};

export const HOST_ONLY_MCP_IDS: Set<string>;
export function jarvisBridgeRegistryEntry(root: string): {
  id: string;
  name: string;
  kind: string;
  command: string;
  args: string[];
  enabled: boolean;
  tags: string[];
  note: string;
};
export function rawHttpBearerToolAllowed(name: string, context?: GatewayPolicyContext, allowRemoteAdmin?: boolean): boolean;
export function assertRawHttpBearerToolAllowed(name: string, context?: GatewayPolicyContext, allowRemoteAdmin?: boolean): void;
export function isHostAdminContext(context?: GatewayPolicyContext, localHostAdmin?: boolean): boolean;
export function assertHostOnlyMcpMutationAllowed(id: string, context?: GatewayPolicyContext, localHostAdmin?: boolean): void;
export function assertMcpServerMutationAllowed(entry: McpRegistryPolicyEntry, context?: GatewayPolicyContext, localHostAdmin?: boolean): void;
