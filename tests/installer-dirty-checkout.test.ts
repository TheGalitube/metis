import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("native Unix updates replace dirty tracked files and divergent commits", () => {
  const linux = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const macos = readFileSync(path.join(root, "install", "macos.sh"), "utf8");
  const start = linux.indexOf('if [[ -n "$commit_sha" ]]; then\n  update_ref=');
  const end = linux.indexOf('\nrestore_stashed_data "$data_dir"', start);
  assert.ok(start >= 0 && end > start);
  const checkoutStep = linux.slice(start, end);
  assert.ok(macos.includes(checkoutStep), "macOS must use the same checkout step");

  const temp = mkdtempSync(path.join(os.tmpdir(), "metis-dirty-update-"));
  const remote = path.join(temp, "remote.git");
  const seed = path.join(temp, "seed");
  const installDir = path.join(temp, "install");
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const checkout = (commitSha: string) => execFileSync("bash", ["-c", "set -euo pipefail\n" + checkoutStep], {
    env: { ...process.env, install_dir: installDir, commit_sha: commitSha, release_version: "" },
    stdio: "pipe",
  });

  try {
    git("init", "--bare", remote);
    git("init", "--initial-branch=master", seed);
    git("-C", seed, "config", "user.name", "Installer Test");
    git("-C", seed, "config", "user.email", "installer@example.invalid");
    writeFileSync(path.join(seed, ".gitignore"), ".env\ndata/\n");
    writeFileSync(path.join(seed, "app.txt"), "release\n");
    git("-C", seed, "add", ".");
    git("-C", seed, "commit", "-m", "release");
    git("-C", seed, "tag", "v1.0.0");
    git("-C", seed, "remote", "add", "origin", remote);
    git("-C", seed, "push", "-u", "origin", "master", "v1.0.0");
    writeFileSync(path.join(seed, "app.txt"), "commit-two\n");
    writeFileSync(path.join(seed, "new.txt"), "remote file\n");
    git("-C", seed, "add", ".");
    git("-C", seed, "commit", "-m", "commit two");
    const selected = git("-C", seed, "rev-parse", "HEAD");
    git("-C", seed, "push", "origin", "master");

    git("clone", remote, installDir);
    git("-C", installDir, "checkout", "v1.0.0");
    git("-C", installDir, "fetch", "origin");
    writeFileSync(path.join(installDir, "app.txt"), "local edit\n");
    writeFileSync(path.join(installDir, "new.txt"), "untracked collision\n");
    writeFileSync(path.join(installDir, ".env"), "PRESERVE=1\n");
    mkdirSync(path.join(installDir, "data"));
    writeFileSync(path.join(installDir, "data", "state.txt"), "keep\n");
    checkout(selected);
    assert.equal(git("-C", installDir, "rev-parse", "HEAD"), selected);
    assert.equal(readFileSync(path.join(installDir, "app.txt"), "utf8"), "commit-two\n");
    assert.equal(readFileSync(path.join(installDir, "new.txt"), "utf8"), "remote file\n");

    writeFileSync(path.join(installDir, "app.txt"), "local commit\n");
    git("-C", installDir, "config", "user.name", "Installer Test");
    git("-C", installDir, "config", "user.email", "installer@example.invalid");
    git("-C", installDir, "commit", "-am", "divergent local commit");
    writeFileSync(path.join(seed, "app.txt"), "commit-three\n");
    git("-C", seed, "commit", "-am", "commit three");
    const latest = git("-C", seed, "rev-parse", "HEAD");
    git("-C", seed, "push", "origin", "master");
    git("-C", installDir, "fetch", "origin");
    writeFileSync(path.join(installDir, "app.txt"), "another local edit\n");
    checkout("");
    assert.equal(git("-C", installDir, "rev-parse", "HEAD"), latest);
    assert.equal(readFileSync(path.join(installDir, "app.txt"), "utf8"), "commit-three\n");
    assert.equal(readFileSync(path.join(installDir, ".env"), "utf8"), "PRESERVE=1\n");
    assert.equal(readFileSync(path.join(installDir, "data", "state.txt"), "utf8"), "keep\n");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
