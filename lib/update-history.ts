import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { formatUpdateInstalledLabel, shortGitSha } from "@/lib/update-display";

export const UPDATE_HISTORY_FILE = "metis-update-history.json";
export const UPDATE_HISTORY_LIMIT = 20;

export type UpdateHistoryStatus = "preparing" | "ready" | "failed";

export type UpdateJobRange = {
  fromLabel: string;
  toLabel: string;
  fromTag?: string | null;
  fromCommit?: string | null;
  toTag?: string | null;
  toCommit?: string | null;
};

export type UpdateHistoryEntry = UpdateJobRange & {
  jobId: string;
  status: UpdateHistoryStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  logs: string[];
};

export function formatUpdateTargetLabel(input: {
  channel: "releases" | "commits";
  tag?: string | null;
  commit?: string | null;
}) {
  if (input.channel === "commits") return shortGitSha(input.commit) || input.commit?.trim() || "master";
  return input.tag?.trim() || "latest";
}

export function buildUpdateJobRange(input: {
  channel: "releases" | "commits";
  currentRef?: string | null;
  currentTag?: string | null;
  currentVersion?: string | null;
  currentCommit?: string | null;
  tag?: string | null;
  commit?: string | null;
}): UpdateJobRange {
  const currentCommit = input.currentCommit || input.currentRef;
  return {
    fromLabel: formatUpdateInstalledLabel(input.channel, currentCommit, input.currentTag || input.currentVersion),
    toLabel: formatUpdateTargetLabel({ channel: input.channel, tag: input.tag, commit: input.commit }),
    fromTag: input.currentTag ?? null,
    fromCommit: currentCommit ?? null,
    toTag: input.tag ?? null,
    toCommit: input.commit ?? null,
  };
}

function historyPath(dataDir = config.dataDir) {
  return path.join(dataDir, UPDATE_HISTORY_FILE);
}

function jobStorePath(dataDir = config.dataDir) {
  return path.join(dataDir, "metis-update-job.json");
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseHistoryEntry(value: unknown): UpdateHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<UpdateHistoryEntry>;
  if (!parsed.jobId || (parsed.status !== "preparing" && parsed.status !== "ready" && parsed.status !== "failed")) return null;
  return {
    jobId: parsed.jobId,
    status: parsed.status,
    startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
    fromLabel: typeof parsed.fromLabel === "string" && parsed.fromLabel.trim() ? parsed.fromLabel : "unknown",
    toLabel: typeof parsed.toLabel === "string" && parsed.toLabel.trim() ? parsed.toLabel : "unknown",
    ...(asOptionalString(parsed.finishedAt) ? { finishedAt: parsed.finishedAt } : {}),
    ...(asOptionalString(parsed.error) ? { error: parsed.error } : {}),
    ...(parsed.fromTag !== undefined ? { fromTag: parsed.fromTag } : {}),
    ...(parsed.fromCommit !== undefined ? { fromCommit: parsed.fromCommit } : {}),
    ...(parsed.toTag !== undefined ? { toTag: parsed.toTag } : {}),
    ...(parsed.toCommit !== undefined ? { toCommit: parsed.toCommit } : {}),
    logs: Array.isArray(parsed.logs) ? parsed.logs.map(String) : [],
  };
}

function historyFromStoredJob(raw: string): UpdateHistoryEntry | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UpdateHistoryEntry> & {
      result?: { tag?: string; commit?: string };
    };
    return parseHistoryEntry({
      ...parsed,
      fromLabel: parsed.fromLabel || "unknown",
      toLabel: parsed.toLabel || parsed.result?.commit || parsed.result?.tag || "unknown",
      toTag: parsed.toTag || parsed.result?.tag || null,
      toCommit: parsed.toCommit || parsed.result?.commit || null,
    });
  } catch {
    return null;
  }
}

export async function readUpdateHistory(dataDir = config.dataDir): Promise<UpdateHistoryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(historyPath(dataDir), "utf8")) as { entries?: unknown };
    if (Array.isArray(parsed.entries)) {
      const entries = parsed.entries.map(parseHistoryEntry).filter((entry): entry is UpdateHistoryEntry => Boolean(entry));
      if (entries.length) return entries;
    }
  } catch {
    // Fall through to the last persisted job so the most recent failure is visible.
  }
  try {
    const recovered = historyFromStoredJob(await readFile(jobStorePath(dataDir), "utf8"));
    return recovered ? [recovered] : [];
  } catch {
    return [];
  }
}

export async function upsertUpdateHistoryEntry(entry: UpdateHistoryEntry, dataDir = config.dataDir) {
  const current = await readUpdateHistory(dataDir);
  const next = [entry, ...current.filter((item) => item.jobId !== entry.jobId)].slice(0, UPDATE_HISTORY_LIMIT);
  await mkdir(dataDir, { recursive: true });
  await writeFile(historyPath(dataDir), `${JSON.stringify({ entries: next })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return next;
}

export function historyEntryFromJob(job: {
  jobId: string;
  status: UpdateHistoryStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  logs: string[];
  fromLabel?: string;
  toLabel?: string;
  fromTag?: string | null;
  fromCommit?: string | null;
  toTag?: string | null;
  toCommit?: string | null;
  result?: { tag?: string; commit?: string };
}): UpdateHistoryEntry {
  return {
    jobId: job.jobId,
    status: job.status,
    startedAt: job.startedAt,
    fromLabel: job.fromLabel || "unknown",
    toLabel: job.toLabel || job.result?.commit || job.result?.tag || "unknown",
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
    fromTag: job.fromTag ?? null,
    fromCommit: job.fromCommit ?? null,
    toTag: job.toTag ?? job.result?.tag ?? null,
    toCommit: job.toCommit ?? job.result?.commit ?? null,
    logs: Array.isArray(job.logs) ? job.logs.map(String) : [],
  };
}
