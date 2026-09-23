export const clientConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "J.A.R.V.I.S. Mk3.1",
  username: process.env.NEXT_PUBLIC_CHAT_USERNAME?.trim() || "",
  defaultCwd: process.env.NEXT_PUBLIC_AGENT_CWD?.trim() || "workspace",
  storagePrefix: process.env.NEXT_PUBLIC_STORAGE_PREFIX?.trim() || "jarvis-mk3-1",
} as const;
