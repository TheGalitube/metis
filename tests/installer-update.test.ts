import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstallerUpdatePlan, installerLogIndicatesFailure, installerLogIndicatesSuccess, installerSystemdEnvironment, installerUpdateScriptPath } from "../lib/installer-update";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const base = {
  root,
  serviceName: "metis-ai",
  dataDir: path.join(root, "data"),
};

test("native Linux settings updates run linux.sh non-interactively", () => {
  const plan = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "releases",
    tag: "v1.0.5",
    platform: "linux",
  });
  assert.equal(plan.kind, "native");
  assert.equal(plan.command, "/bin/bash");
  assert.equal(plan.scriptSource, path.join(root, "install", "linux.sh"));
  assert.deepEqual(plan.args, [
    plan.scriptSource,
    "--non-interactive",
    "--native",
    "--install-dir",
    root,
    "--service-name",
    "metis-ai",
    "--version",
    "v1.0.5",
  ]);
  assert.equal(plan.unitName, "metis-ai-self-update");
});

test("native commit updates omit --version so the installer selects origin/master", () => {
  const plan = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "commits",
    tag: "v1.0.5",
    platform: "linux",
  });
  assert.equal(plan.args.includes("--version"), false);
});

test("native commit plans pin the selected SHA with --commit", () => {
  const plan = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "commits",
    commit: "abcdef1234567890",
    platform: "linux",
  });
  assert.equal(plan.args.includes("--commit"), true);
  assert.equal(plan.args.includes("abcdef1234567890"), true);
  assert.equal(plan.args.includes("--version"), false);
});

test("Docker settings updates run docker.sh with the release tag", () => {
  const plan = buildInstallerUpdatePlan({
    ...base,
    docker: true,
    channel: "releases",
    tag: "v1.0.5",
    platform: "linux",
  });
  assert.equal(plan.kind, "docker");
  assert.equal(plan.scriptSource, path.join(root, "public", "install", "docker.sh"));
  assert.deepEqual(plan.args, [
    plan.scriptSource,
    "--non-interactive",
    "--install-dir",
    root,
    "--version",
    "v1.0.5",
  ]);
});

test("macOS and Windows plans use the platform installer files", () => {
  const mac = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "releases",
    tag: "v1.0.5",
    platform: "darwin",
  });
  assert.equal(mac.scriptSource, path.join(root, "install", "macos.sh"));
  assert.equal(mac.unitName, undefined);

  const win = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "releases",
    tag: "v1.0.5",
    platform: "win32",
  });
  assert.equal(win.command, "powershell.exe");
  assert.equal(win.scriptSource, path.join(root, "install", "windows.ps1"));
  assert.equal(win.args.includes("-Version"), true);
  assert.equal(win.args.includes("v1.0.5"), true);
});

test("copied installer scripts stay in dataDir, not systemd PrivateTmp", () => {
  const dest = installerUpdateScriptPath("/var/lib/metis/data", path.join(root, "install", "linux.sh"));
  assert.equal(dest, "/var/lib/metis/data/metis-ai-update-run.sh");
  assert.equal(dest.includes("/tmp/"), false);
});

test("systemd-run environment always includes HOME", () => {
  const args = installerSystemdEnvironment({ PATH: "/bin", USER: "root", NODE_ENV: "test" });
  assert.equal(args.some((value) => value.startsWith("--setenv=HOME=") && value.length > "--setenv=HOME=".length), true);
  assert.equal(args.includes("--setenv=USER=root"), true);
  assert.equal(args.includes("--setenv=PATH=/bin"), true);
});

test("installer logs detect the HOME unbound failure", () => {
  assert.equal(installerLogIndicatesFailure("/tmp/metis-ai-update.sh: line 9: HOME: unbound variable"), true);
  assert.equal(installerLogIndicatesFailure("Error: git pull failed"), true);
  assert.equal(installerLogIndicatesFailure("Installing packages..."), false);
});

test("installer logs detect a finished native install", () => {
  assert.equal(installerLogIndicatesSuccess("Metis AI installed successfully."), true);
  assert.equal(installerLogIndicatesSuccess("Installing packages..."), false);
});
