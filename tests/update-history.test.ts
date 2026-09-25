import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildUpdateJobRange,
  historyEntryFromJob,
  readUpdateHistory,
  UPDATE_HISTORY_LIMIT,
  upsertUpdateHistoryEntry,
} from "../lib/update-history";
import { installerUpdateScriptPath, initializeInstallerUpdateLog, installerUpdateLogPath } from "../lib/installer-update";

test("commit ranges use short SHAs for from and to", () => {
  const range = buildUpdateJobRange({
    channel: "commits",
    currentCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.equal(range.fromLabel, "aaaaaaaaaaaa");
  assert.equal(range.toLabel, "bbbbbbbbbbbb");
});

test("release ranges keep the installed tag and target tag", () => {
  const range = buildUpdateJobRange({
    channel: "releases",
    currentTag: "v1.0.5",
    currentVersion: "1.0.5",
    tag: "v1.0.9",
  });
  assert.equal(range.fromLabel, "v1.0.5");
  assert.equal(range.toLabel, "v1.0.9");
});

test("history upsert keeps the newest entry first and recovers the last job", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "metis-update-history-"));
  try {
    await writeFile(path.join(dataDir, "metis-update-job.json"), `${JSON.stringify({
      jobId: "old-job",
      status: "failed",
      startedAt: "2026-09-26T00:45:00.000Z",
      error: "Installer update failed (systemd result=exit-code, status=127).",
      logs: ["/bin/bash: /tmp/metis-ai-update.sh: No such file or directory"],
    })}\n`);
    const recovered = await readUpdateHistory(dataDir);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.jobId, "old-job");
    assert.equal(recovered[0]?.status, "failed");

    const first = historyEntryFromJob({
      jobId: "job-1",
      status: "failed",
      startedAt: "2026-09-26T01:00:00.000Z",
      fromLabel: "da77d279b35e",
      toLabel: "c4aea5b",
      logs: ["copied installer to dataDir"],
    });
    const next = await upsertUpdateHistoryEntry(first, dataDir);
    assert.equal(next[0]?.jobId, "job-1");
    assert.equal(next[0]?.fromLabel, "da77d279b35e");
    assert.equal(next[0]?.toLabel, "c4aea5b");
    assert.equal(next.some((entry) => entry.jobId === "old-job"), true);
    const stored = JSON.parse(await readFile(path.join(dataDir, "metis-update-history.json"), "utf8")) as { entries: Array<{ jobId: string }> };
    assert.equal(stored.entries[0]?.jobId, "job-1");
    assert.ok(stored.entries.length <= UPDATE_HISTORY_LIMIT);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("installer update logs append from/to headers for later jobs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "metis-update-log-"));
  try {
    await initializeInstallerUpdateLog(dataDir, "job-a", { fromLabel: "v1.0.5", toLabel: "v1.0.9" });
    await initializeInstallerUpdateLog(dataDir, "job-b", { fromLabel: "v1.0.9", toLabel: "master" });
    const text = await readFile(installerUpdateLogPath(dataDir), "utf8");
    assert.match(text, /\[metis-update-job:job-a\]/);
    assert.match(text, /from: v1\.0\.5/);
    assert.match(text, /to: v1\.0\.9/);
    assert.match(text, /\[metis-update-job:job-b\]/);
    assert.match(text, /to: master/);
    assert.equal(installerUpdateScriptPath(dataDir, "/repo/install/linux.sh"), path.join(dataDir, "metis-ai-update-run.sh"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
