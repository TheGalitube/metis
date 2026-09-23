import type { AgentMode, ToolPermissionCategory } from "@/lib/store";

export const TOOL_PERMISSION_CATEGORIES: ToolPermissionCategory[] = [
  "read",
  "write",
  "terminal",
  "browser",
  "memory",
  "remote",
  "plan",
  "subagent",
];

export const BUILT_IN_MODES: AgentMode[] = [
  {
    id: "agent",
    name: "Agent",
    description: "Use all available tools and make changes.",
    icon: "bot",
    instructions: "You are J.A.R.V.I.S. Mk3.1, running in the J.A.R.V.I.S. workspace. Work toward the user's goal with the available tools, while respecting the selected runtime mode, tool permissions, and approval boundaries. Call known tools directly; use discovery when a capability is genuinely unknown. For three or more distinct steps, maintain a Tasks checklist before the first mutating action and update it as work completes. Create a plan document only when the user requests one. For interactive web tasks, use the configured in-app browser tools. Ask for credentials only when required, and never expose them in a response or log. Verify builds, deployments, and configuration changes before reporting them as complete. Read routed skill instructions before relevant work.",
    allowedCategories: [...TOOL_PERMISSION_CATEGORIES],
    builtIn: true,
  },
  {
    id: "plan",
    name: "Plan",
    description: "Read, investigate, and create plans without changing files.",
    icon: "map",
    instructions: "You are in Plan mode. Research with read-only tools and spawn subagents for research, planning, and code reading. Subagents must not write files or create the final plan. You MUST write the plan yourself by calling create_plan with the complete plan so it opens in the side panel, then mention it as [Title](workspace://plan/<id>). Use write_todos for a 3+ step in-chat checklist, and create_note with kind=project when the work spans chats. Never call request_mode_change and never ask to switch to Agent — the user builds with Build / Build in parallel. Inspect freely: read files, git, browser, docs, memories/notes, and remote hosts with inspect-only commands. Do not modify files, services, registry, or scheduled tasks. Research/read MCPs are allowed; provisioning and mutating child tools are not. Name independent workstreams in the plan so Build in parallel can spawn clickable subagents.",
    allowedCategories: ["read", "browser", "plan", "memory", "subagent"],
    builtIn: true,
  },
  {
    id: "ask",
    name: "Ask",
    description: "Answer using read-only tools.",
    icon: "message-circle-question",
    instructions: "Answer the user and investigate with read-only tools. Do not make changes.",
    allowedCategories: ["read", "browser"],
    builtIn: true,
  },
];

export function normalizeMode(mode: AgentMode): AgentMode {
  const allowed = new Set(TOOL_PERMISSION_CATEGORIES);
  return {
    id: mode.id.trim().slice(0, 80),
    name: mode.name.trim().slice(0, 80) || "Custom mode",
    description: mode.description.trim().slice(0, 300),
    icon: mode.icon.trim().slice(0, 60) || "sliders-horizontal",
    instructions: mode.instructions.slice(0, 20_000),
    allowedCategories: [...new Set(mode.allowedCategories.filter((item) => allowed.has(item)))],
    ...(mode.toolOverrides ? {
      toolOverrides: Object.fromEntries(
        Object.entries(mode.toolOverrides).slice(0, 500).map(([name, value]) => [name.slice(0, 120), Boolean(value)]),
      ),
    } : {}),
    ...(mode.builtIn ? { builtIn: true } : {}),
  };
}

export function allModes(customModes: AgentMode[] = []) {
  return [...BUILT_IN_MODES, ...customModes.filter((mode) => !BUILT_IN_MODES.some((builtIn) => builtIn.id === mode.id)).map(normalizeMode)];
}

export function modeById(id: string | undefined, customModes: AgentMode[] = []) {
  return allModes(customModes).find((mode) => mode.id === id) || BUILT_IN_MODES[0];
}

/** True when a plan is large enough that parallel subagents are likely useful. */
export function planLooksParallelizable(content: string) {
  const text = content.trim();
  if (!text) return false;
  if (text.length >= 1_800) return true;
  const headings = text.match(/^#{1,3}\s/gm)?.length ?? 0;
  if (headings >= 3) return true;
  const files = text.match(/`[^`\n]+\.[A-Za-z0-9]+`/g)?.length ?? 0;
  if (files >= 3) return true;
  const checks = text.match(/^\s*[-*]\s+\[[ xX]\]/gm)?.length ?? 0;
  return checks >= 4;
}
