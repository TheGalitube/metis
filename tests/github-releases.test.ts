import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  checkForUpdate,
  commitChannelUpdateAvailable,
  compareReleaseVersions,
  formatUpdateInstalledLabel,
  githubRepoFromRemoteUrl,
  isReleaseNewer,
  listUpdateVersions,
  loadLocalUpdateIdentity,
  sameGitSha,
  type GithubRelease,
} from "../lib/github-releases";

const execFileAsync = promisify(execFile);

const release = (tag: string, commit?: string): GithubRelease => ({
  tag_name: tag,
  target_commitish: commit,
});

test("a different release tag is treated as an available update", () => {
  assert.equal(isReleaseNewer(release("v1.4.0"), "v1.3.2"), true);
  assert.equal(isReleaseNewer(release("1.4.0"), "v1.4.0"), false);
  assert.equal(isReleaseNewer(release("v1.4.0", "abc123"), "abc123"), false);
});

test("unknown, commit, or empty current refs do not claim a stable update", () => {
  assert.equal(isReleaseNewer(release("v1.4.0"), "unknown"), false);
  assert.equal(isReleaseNewer(release("v1.4.0", "abc123"), "abc123"), false);
  assert.equal(isReleaseNewer(release("v1.4.0"), ""), false);
});

test("compares release versions instead of tag strings", () => {
  assert.equal(compareReleaseVersions("v1.10.0", "v1.9.9"), 1);
  assert.equal(compareReleaseVersions("v1.2.3", "v1.2.3"), 0);
  assert.equal(compareReleaseVersions("v1.2.3-rc.1", "v1.2.3"), -1);
  assert.equal(compareReleaseVersions("v1.2.4", "v1.2.3"), 1);
});

test("stable channel does not report the same release for a development checkout", async () => {
  const root = await mkdtemp(`${os.tmpdir()}/metis-update-test-`);
  const previousDistDir = process.env.NEXT_DIST_DIR;
  try {
    await mkdir(`${root}/.next`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ version: "1.0.0" }));
    await writeFile(`${root}/.next/release-manifest.json`, JSON.stringify({
      schemaVersion: 1, version: "1.0.0", packageVersion: "1.0.0", tag: null,
      commit: "abc123", channel: "development", isRelease: false, builtAt: new Date().toISOString(),
    }));
    process.env.NEXT_DIST_DIR = ".next";
    const result = await checkForUpdate(root, async () => new Response(JSON.stringify({
      tag_name: "v1.0.0", name: "v1.0.0", draft: false, prerelease: false,
    }), { status: 200 }));
    assert.equal(result.status, "up-to-date");
    assert.equal(result.updateAvailable, false);
  } finally {
    if (previousDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = previousDistDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("commit channel reports a newer master commit", async () => {
  const root = await mkdtemp(`${os.tmpdir()}/metis-update-test-`);
  const previousDistDir = process.env.NEXT_DIST_DIR;
  try {
    await mkdir(`${root}/.next`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ version: "1.0.0" }));
    await writeFile(`${root}/.next/release-manifest.json`, JSON.stringify({
      schemaVersion: 1, version: "1.0.0", packageVersion: "1.0.0", tag: null,
      commit: "abc123", channel: "development", isRelease: false, builtAt: new Date().toISOString(),
    }));
    process.env.NEXT_DIST_DIR = ".next";
    const result = await checkForUpdate(root, async () => new Response(JSON.stringify({
      sha: "def456", html_url: "https://github.com/f1shyondrugs/metis-ai/commit/def456",
      commit: { message: "new work" },
    }), { status: 200 }), "commits");
    assert.equal(result.status, "commit-available");
    assert.equal(result.latestCommit, "def456");
    assert.equal(result.updateAvailable, true);
  } finally {
    if (previousDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = previousDistDir;
    await rm(root, { recursive: true, force: true });
  }
});

const LIVE_SHA = "06c388caeb37eb4ba6e459ec0b051e0445e11b4f";
const STALE_SHA = "a8344f452dd694072b49c93b83a43b8c729848de";

test("sameGitSha matches full and abbreviated SHAs", () => {
  assert.equal(sameGitSha(LIVE_SHA, "06c388caeb37"), true);
  assert.equal(sameGitSha(LIVE_SHA, STALE_SHA), false);
  assert.equal(sameGitSha("1.0.0", LIVE_SHA), false);
});

test("commit channel stays current when checkout HEAD already matches latest", () => {
  assert.equal(commitChannelUpdateAvailable(LIVE_SHA, STALE_SHA, LIVE_SHA), false);
  assert.equal(commitChannelUpdateAvailable(LIVE_SHA, STALE_SHA, STALE_SHA), true);
  assert.equal(commitChannelUpdateAvailable(LIVE_SHA, LIVE_SHA, null), false);
  assert.equal(commitChannelUpdateAvailable(LIVE_SHA, LIVE_SHA, STALE_SHA), true);
});

test("commit channel installed label uses the SHA, not package version", () => {
  assert.equal(formatUpdateInstalledLabel("commits", LIVE_SHA, "1.0.0"), "06c388caeb37");
  assert.equal(formatUpdateInstalledLabel("releases", LIVE_SHA, "1.0.0"), "1.0.0");
});

test("commit channel is current when git HEAD matches latest even if the slot manifest is stale", async () => {
  const root = await mkdtemp(`${os.tmpdir()}/metis-update-head-`);
  const previousDistDir = process.env.NEXT_DIST_DIR;
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousReleaseCommit = process.env.METIS_RELEASE_COMMIT;
  try {
    delete process.env.GITHUB_SHA;
    delete process.env.METIS_RELEASE_COMMIT;
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: root });
    await writeFile(`${root}/README.md`, "head match\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await mkdir(`${root}/.next`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ version: "1.0.0" }));
    await writeFile(`${root}/.next/release-manifest.json`, JSON.stringify({
      schemaVersion: 1, version: "1.0.0", packageVersion: "1.0.0", tag: null,
      commit: STALE_SHA, channel: "development", isRelease: false, builtAt: new Date().toISOString(),
    }));
    process.env.NEXT_DIST_DIR = ".next";
    const result = await checkForUpdate(root, async () => new Response(JSON.stringify({
      sha: head, html_url: `https://github.com/f1shyondrugs/metis-ai/commit/${head}`,
      commit: { message: "already checked out" },
    }), { status: 200 }), "commits");
    assert.equal(result.updateAvailable, false);
    assert.equal(result.status, "up-to-date");
    assert.equal(sameGitSha(result.currentRef, head), true);
  } finally {
    if (previousDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = previousDistDir;
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousReleaseCommit === undefined) delete process.env.METIS_RELEASE_COMMIT;
    else process.env.METIS_RELEASE_COMMIT = previousReleaseCommit;
    await rm(root, { recursive: true, force: true });
  }
});

test("commit channel is behind when git HEAD is stale even if the slot manifest matches latest", async () => {
  const root = await mkdtemp(`${os.tmpdir()}/metis-update-behind-`);
  const previousDistDir = process.env.NEXT_DIST_DIR;
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousReleaseCommit = process.env.METIS_RELEASE_COMMIT;
  try {
    delete process.env.GITHUB_SHA;
    delete process.env.METIS_RELEASE_COMMIT;
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: root });
    await writeFile(`${root}/README.md`, "behind\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await mkdir(`${root}/.next`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ version: "1.0.0" }));
    await writeFile(`${root}/.next/release-manifest.json`, JSON.stringify({
      schemaVersion: 1, version: "1.0.0", packageVersion: "1.0.0", tag: null,
      commit: LIVE_SHA, channel: "development", isRelease: false, builtAt: new Date().toISOString(),
    }));
    process.env.NEXT_DIST_DIR = ".next";
    const result = await checkForUpdate(root, async () => new Response(JSON.stringify({
      sha: LIVE_SHA, html_url: `https://github.com/f1shyondrugs/metis-ai/commit/${LIVE_SHA}`,
      commit: { message: "newer origin" },
    }), { status: 200 }), "commits");
    assert.equal(result.updateAvailable, true);
    assert.equal(result.status, "commit-available");
    assert.equal(sameGitSha(result.currentRef, head), true);
    assert.equal(sameGitSha(result.latestCommit, LIVE_SHA), true);
  } finally {
    if (previousDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = previousDistDir;
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousReleaseCommit === undefined) delete process.env.METIS_RELEASE_COMMIT;
    else process.env.METIS_RELEASE_COMMIT = previousReleaseCommit;
    await rm(root, { recursive: true, force: true });
  }
});

test("listUpdateVersions marks the current tag and commit", async () => {
  const root = await mkdtemp(`${os.tmpdir()}/metis-update-list-`);
  const previousDistDir = process.env.NEXT_DIST_DIR;
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousReleaseCommit = process.env.METIS_RELEASE_COMMIT;
  try {
    delete process.env.GITHUB_SHA;
    delete process.env.METIS_RELEASE_COMMIT;
    await mkdir(`${root}/.next`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ version: "1.0.5" }));
    await writeFile(`${root}/.next/release-manifest.json`, JSON.stringify({
      schemaVersion: 1, version: "1.0.5", packageVersion: "1.0.5", tag: "v1.0.5",
      commit: LIVE_SHA, channel: "stable", isRelease: true, builtAt: new Date().toISOString(),
    }));
    process.env.NEXT_DIST_DIR = ".next";
    process.env.METIS_RELEASE_COMMIT = LIVE_SHA;
    const listed = await listUpdateVersions(root, async (url) => {
      const href = String(url);
      if (href.includes("/releases?")) {
        return new Response(JSON.stringify([
          { tag_name: "v1.0.5", name: "Metis 1.0.5", body: "Latest notes", html_url: "https://github.com/f1shyondrugs/metis-ai/releases/tag/v1.0.5", published_at: "2026-09-12T00:00:00Z", draft: false, prerelease: false },
          { tag_name: "v1.0.4", name: "Metis 1.0.4", body: "Older notes", html_url: "https://github.com/f1shyondrugs/metis-ai/releases/tag/v1.0.4", published_at: "2026-09-01T00:00:00Z", draft: false, prerelease: false },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([
        { sha: LIVE_SHA, html_url: `https://github.com/f1shyondrugs/metis-ai/commit/${LIVE_SHA}`, commit: { message: "keep installer updates alive\n\nDetails here.", author: { name: "f1shy", date: "2026-09-13T20:00:00Z" } } },
        { sha: STALE_SHA, html_url: `https://github.com/f1shyondrugs/metis-ai/commit/${STALE_SHA}`, commit: { message: "older work" } },
      ]), { status: 200 });
    });
    assert.equal(listed.releases[0]?.current, true);
    assert.equal(listed.releases[1]?.current, false);
    assert.equal(listed.commits[0]?.current, true);
    assert.equal(listed.commits[0]?.title, "keep installer updates alive");
    assert.equal(listed.commits[0]?.body, "Details here.");
    assert.equal(listed.commits[1]?.current, false);
  } finally {
    if (previousDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = previousDistDir;
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousReleaseCommit === undefined) delete process.env.METIS_RELEASE_COMMIT;
    else process.env.METIS_RELEASE_COMMIT = previousReleaseCommit;
    await rm(root, { recursive: true, force: true });
  }
});

test("installed label falls back to the package version instead of unknown", () => {
  assert.equal(formatUpdateInstalledLabel("commits", "unknown", "1.0.9"), "1.0.9");
  assert.equal(formatUpdateInstalledLabel("commits", "", "1.0.9"), "1.0.9");
  assert.equal(githubRepoFromRemoteUrl("https://github.com/f1shyondrugs/metis.git"), "f1shyondrugs/metis");
  assert.equal(githubRepoFromRemoteUrl("git@github.com:f1shyondrugs/metis.git"), "f1shyondrugs/metis");
});

test("local identity keeps the git SHA when GitHub is unavailable", async () => {
  const root = await mkdtemp(`${os.tmpdir()}/metis-update-local-`);
  const previousDistDir = process.env.NEXT_DIST_DIR;
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousReleaseCommit = process.env.METIS_RELEASE_COMMIT;
  try {
    delete process.env.GITHUB_SHA;
    delete process.env.METIS_RELEASE_COMMIT;
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: root });
    await writeFile(`${root}/README.md`, "local identity\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await mkdir(`${root}/.next`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ version: "1.0.9" }));
    await writeFile(`${root}/.next/release-manifest.json`, JSON.stringify({
      schemaVersion: 1, version: "1.0.9", packageVersion: "1.0.9", tag: null,
      commit: head, channel: "development", isRelease: false, builtAt: new Date().toISOString(),
    }));
    process.env.NEXT_DIST_DIR = ".next";
    const identity = await loadLocalUpdateIdentity(root);
    assert.equal(sameGitSha(identity.currentRef, head), true);
    const listed = await listUpdateVersions(root, async () => new Response("rate limit", { status: 403 }));
    assert.equal(listed.commits[0]?.sha, head);
    assert.equal(listed.commits[0]?.current, true);
  } finally {
    if (previousDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = previousDistDir;
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousReleaseCommit === undefined) delete process.env.METIS_RELEASE_COMMIT;
    else process.env.METIS_RELEASE_COMMIT = previousReleaseCommit;
    await rm(root, { recursive: true, force: true });
  }
});

test("commit channel does not offer an update that would move HEAD backwards", async () => {
  const root = await mkdtemp(`${os.tmpdir()}/metis-update-ahead-`);
  const previousDistDir = process.env.NEXT_DIST_DIR;
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousReleaseCommit = process.env.METIS_RELEASE_COMMIT;
  try {
    delete process.env.GITHUB_SHA;
    delete process.env.METIS_RELEASE_COMMIT;
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "test"], { cwd: root });
    await writeFile(`${root}/README.md`, "first\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "first"], { cwd: root });
    const parent = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await writeFile(`${root}/README.md`, "second\n");
    await execFileAsync("git", ["commit", "-am", "second"], { cwd: root });
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await mkdir(`${root}/.next`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ version: "1.0.9" }));
    await writeFile(`${root}/.next/release-manifest.json`, JSON.stringify({
      schemaVersion: 1, version: "1.0.9", packageVersion: "1.0.9", tag: null,
      commit: head, channel: "development", isRelease: false, builtAt: new Date().toISOString(),
    }));
    process.env.NEXT_DIST_DIR = ".next";
    const result = await checkForUpdate(root, async () => new Response(JSON.stringify({
      sha: parent, html_url: `https://github.com/f1shyondrugs/metis/commit/${parent}`,
      commit: { message: "older github view" },
    }), { status: 200 }), "commits");
    assert.equal(result.updateAvailable, false);
    assert.equal(result.status, "up-to-date");
    assert.equal(sameGitSha(result.currentRef, head), true);
  } finally {
    if (previousDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = previousDistDir;
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousReleaseCommit === undefined) delete process.env.METIS_RELEASE_COMMIT;
    else process.env.METIS_RELEASE_COMMIT = previousReleaseCommit;
    await rm(root, { recursive: true, force: true });
  }
});
