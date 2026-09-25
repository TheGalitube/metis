import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import {
  initializeInstallerUpdateLog,
  installerLogForJob,
  installerLogIndicatesFailure,
  installerLogIndicatesSuccess,
  installerUpdateIsRunning,
  readInstallerUpdateLog,
  runInstallerUpdate,
  type InstallerUpdateInput,
} from "@/lib/installer-update";
import { historyEntryFromJob, upsertUpdateHistoryEntry, type UpdateJobRange } from "@/lib/update-history";
import { clearMaintenanceState, setMaintenanceState } from "@/lib/maintenance-state";

type UpdateJobResult = {
  tag: string;
  commit?: string;
  method?: "installer";
  asset: string;
  activeSlot?: ".next-a" | ".next-b";
  preparedSlot?: ".next-a" | ".next-b";
};

export type UpdateJob = {
  jobId: string;
  status: "preparing" | "ready" | "failed";
  startedAt: string;
  startedByPid?: number;
  finishedAt?: string;
  result?: UpdateJobResult;
  error?: string;
  logs: string[];
} & Partial<UpdateJobRange>;

const jobs = new Map<string, UpdateJob>();
const INSTALLER_REASON = "Metis is being updated with the same installer used for a fresh install. Keep this page open.";

function jobStorePath(dataDir = config.dataDir) {
  return path.join(dataDir, "metis-update-job.json");
}

async function persistJob(job: UpdateJob) {
  try {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(jobStorePath(), `${JSON.stringify(job)}\n`, { encoding: "utf8", mode: 0o600 });
    await upsertUpdateHistoryEntry(historyEntryFromJob(job));
  } catch {
    // Status polling can still recover from the installer log after a restart.
  }
}

function parseStoredJob(raw: string): UpdateJob | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UpdateJob>;
    if (!parsed.jobId || (parsed.status !== "preparing" && parsed.status !== "ready" && parsed.status !== "failed")) return null;
    return {
      jobId: parsed.jobId,
      status: parsed.status,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      ...(typeof parsed.startedByPid === "number" ? { startedByPid: parsed.startedByPid } : {}),
      ...(parsed.finishedAt ? { finishedAt: parsed.finishedAt } : {}),
      ...(parsed.result ? { result: parsed.result } : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
      ...(parsed.fromLabel ? { fromLabel: parsed.fromLabel } : {}),
      ...(parsed.toLabel ? { toLabel: parsed.toLabel } : {}),
      ...(parsed.fromTag !== undefined ? { fromTag: parsed.fromTag } : {}),
      ...(parsed.fromCommit !== undefined ? { fromCommit: parsed.fromCommit } : {}),
      ...(parsed.toTag !== undefined ? { toTag: parsed.toTag } : {}),
      ...(parsed.toCommit !== undefined ? { toCommit: parsed.toCommit } : {}),
      logs: Array.isArray(parsed.logs) ? parsed.logs.map(String) : [],
    };
  } catch {
    return null;
  }
}

async function readPersistedJob(): Promise<UpdateJob | null> {
  try {
    return parseStoredJob(await readFile(jobStorePath(), "utf8"));
  } catch {
    return null;
  }
}

export function settleUpdateJobFromInstaller(
  job: UpdateJob,
  input: { installerRunning: boolean; logText: string; currentPid?: number; now?: string },
): UpdateJob {
  if (job.status !== "preparing") return job;
  const scopedLog = installerLogForJob(input.logText, job.jobId);
  if (!scopedLog) return job;

  const logs = scopedLog.trim().split(/\r?\n/);
  if (input.installerRunning) return { ...job, logs };

  const now = input.now || new Date().toISOString();
  const last = logs.filter(Boolean).at(-1);
  if (installerLogIndicatesFailure(scopedLog)) {
    return { ...job, status: "failed", error: last || "Installer update failed.", finishedAt: now, logs };
  }
  if (!installerLogIndicatesSuccess(scopedLog)) {
    return { ...job, logs };
  }

  const currentPid = input.currentPid ?? process.pid;
  if (!job.startedByPid || currentPid === job.startedByPid) {
    return { ...job, logs };
  }

  return {
    ...job,
    status: "ready",
    finishedAt: now,
    logs,
    result: job.result || { tag: "latest", asset: "installer", method: "installer" },
  };
}

async function applyInstallerState(job: UpdateJob) {
  if (job.status !== "preparing") return job;
  const [running, logs] = await Promise.all([
    installerUpdateIsRunning(config.serviceName),
    readInstallerUpdateLog(config.dataDir, 200),
  ]);
  const next = settleUpdateJobFromInstaller(job, {
    installerRunning: running,
    logText: logs.join("\n"),
    currentPid: process.pid,
  });
  jobs.set(next.jobId, next);
  if (next.status !== "preparing") {
    await persistJob(next);
    await clearMaintenanceState();
  } else if (next.logs !== job.logs) {
    await persistJob(next);
  }
  return next;
}

async function startUpdateJob(
  prepare: (logger: (message: string) => void) => Promise<UpdateJobResult>,
  reason = INSTALLER_REASON,
  initialize?: (job: UpdateJob) => Promise<void>,
) {
  const job: UpdateJob = {
    jobId: randomUUID(),
    status: "preparing",
    startedAt: new Date().toISOString(),
    startedByPid: process.pid,
    logs: ["Update job created."],
  };
  const log = (message: string) => { job.logs.push(`${new Date().toISOString()} ${message}`); };

  await initialize?.(job);
  log("Maintenance mode enabled.");
  await setMaintenanceState(job.jobId, reason);
  jobs.set(job.jobId, job);
  await persistJob(job);

  void prepare(log).then(async (result) => {
    job.result = result;
    log("Installer process finished; waiting for the restarted Metis process.");
    jobs.set(job.jobId, job);
    await persistJob(job);
  }).catch(async (error) => {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    log(`Update failed: ${job.error}`);
    jobs.set(job.jobId, job);
    await persistJob(job);
    await clearMaintenanceState();
  });
  return job;
}

export function startInstallerUpdateJob(input: InstallerUpdateInput, range?: UpdateJobRange) {
  const labels = range || {
    fromLabel: "unknown",
    toLabel: input.commit || input.tag || (input.channel === "commits" ? "master" : "latest"),
    toTag: input.tag,
    toCommit: input.commit,
  };
  return startUpdateJob(async (log) => {
    const result = await runInstallerUpdate(input, log);
    return { ...result, commit: input.commit };
  }, INSTALLER_REASON, async (job) => {
    Object.assign(job, labels);
    await initializeInstallerUpdateLog(input.dataDir, job.jobId, labels);
  });
}

export function getUpdateJob(jobId: string) {
  return jobs.get(jobId) || null;
}

export async function resolveUpdateJob(jobId: string): Promise<UpdateJob | null> {
  const id = jobId.trim();
  if (!id) return null;
  const remembered = jobs.get(id) || (await readPersistedJob());
  if (remembered && remembered.jobId === id) {
    jobs.set(remembered.jobId, remembered);
    return applyInstallerState(remembered);
  }
  return null;
}
