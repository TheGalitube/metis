import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerDir = path.join(root, "public", "install");

test("all platform installers and uninstallers are published", () => {
  for (const file of [
    "linux.sh",
    "macos.sh",
    "windows.ps1",
    "uninstall.sh",
    "uninstall-macos.sh",
    "uninstall.ps1",
    "manifest.json",
    "install.sh",
    "install.ps1",
  ]) {
    assert.equal(existsSync(path.join(installerDir, file)), true, file);
  }
  assert.equal(existsSync(path.join(root, "install.sh")), true, "root install.sh");
  assert.equal(existsSync(path.join(root, "install.ps1")), true, "root install.ps1");
});

test("published installers match the install/ sources", () => {
  for (const file of ["linux.sh", "macos.sh", "windows.ps1", "uninstall.sh", "uninstall-macos.sh", "uninstall.ps1"]) {
    const source = readFileSync(path.join(root, "install", file), "utf8");
    const published = readFileSync(path.join(installerDir, file), "utf8");
    assert.equal(published, source, file);
  }
  assert.equal(readFileSync(path.join(installerDir, "install.sh"), "utf8"), readFileSync(path.join(root, "install.sh"), "utf8"));
  assert.equal(readFileSync(path.join(installerDir, "install.ps1"), "utf8"), readFileSync(path.join(root, "install.ps1"), "utf8"));
});

test("installer sources do not contain this deployment's machine path", () => {
  const files = [
    "install.sh",
    "install.ps1",
    path.join("install", "linux.sh"),
    path.join("install", "macos.sh"),
    path.join("install", "windows.ps1"),
    path.join("install", "uninstall.sh"),
    path.join("install", "uninstall-macos.sh"),
    path.join("install", "uninstall.ps1"),
  ];
  const localPath = ["/home", "f1shy312"].join("/");
  const localDomain = ["metis-ai", "f1shy312.com"].join(".");
  for (const file of files) {
    const content = readFileSync(path.join(root, file), "utf8");
    assert.equal(content.includes(localPath), false, file);
    assert.equal(content.includes(localDomain), false, file);
  }
});

test("macos and windows installers default to Docker and keep a native fallback", () => {
  const macos = readFileSync(path.join(root, "install", "macos.sh"), "utf8");
  const publicMacos = readFileSync(path.join(installerDir, "macos.sh"), "utf8");
  for (const source of [macos, publicMacos]) {
    assert.match(source, /--native/);
    assert.match(source, /docker compose/);
    assert.match(source, /force_native == 0 \)\) && command -v docker/);
  }
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  assert.match(windows, /-Native/);
  assert.match(windows, /docker compose/);
  assert.equal(existsSync(path.join(root, "Dockerfile")), true);
  assert.equal(existsSync(path.join(root, "docker-compose.yml")), true);
  assert.equal(existsSync(path.join(root, "docker", "entrypoint.sh")), true);
});

test("linux installer defaults to native systemd and requires --docker", () => {
  const content = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const publicContent = readFileSync(path.join(installerDir, "linux.sh"), "utf8");
  for (const source of [content, publicContent]) {
    assert.match(source, /--docker\s+Install with Docker Compose/);
    assert.match(source, /--native\s+Install with Node\.js \+ systemd \(default\)/);
    assert.match(source, /force_docker=1/);
    assert.match(source, /if \(\( force_docker \)\)/);
    assert.match(source, /Use either --docker or --native, not both/);
    assert.doesNotMatch(source, /force_native == 0 \)\) && command -v docker/);
  }
});

test("linux systemd services apply a hardened sandbox around app and worker", () => {
  const appUnit = readFileSync(path.join(root, "deploy", "systemd", "metis-ai.service.template"), "utf8");
  const workerUnit = readFileSync(path.join(root, "deploy", "systemd", "metis-ai-worker.service.template"), "utf8");
  const gatewayUnit = readFileSync(path.join(root, "deploy", "systemd", "metis-ai-mcp.service.template"), "utf8");
  for (const unit of [appUnit, workerUnit]) {
    assert.match(unit, /^UMask=0077$/m);
    assert.match(unit, /^NoNewPrivileges=true$/m);
    assert.match(unit, /^PrivateTmp=true$/m);
    assert.match(unit, /^ProtectSystem=full$/m);
    assert.match(unit, /^ReadWritePaths=YOUR_DATA_DIR YOUR_INSTALL_DIR$/m);
    assert.match(unit, /^ProtectKernelModules=true$/m);
    assert.match(unit, /^RestrictSUIDSGID=true$/m);
  }
  assert.match(gatewayUnit, /^UMask=0077$/m);
  assert.match(gatewayUnit, /^NoNewPrivileges=false$/m);
  assert.match(gatewayUnit, /^ProtectSystem=false$/m);
  assert.doesNotMatch(gatewayUnit, /^ReadWritePaths=/m);

  for (const file of ["install/linux.sh", "public/install/linux.sh"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.match(source, /write_unit "\$\{service_name\}\.service" "Metis AI" full true/);
    assert.match(source, /write_unit "\$\{service_name\}-worker\.service" "Metis AI worker" full true/);
    assert.match(source, /write_unit "\$\{service_name\}-mcp\.service" "Metis AI MCP gateway" false false/);
    assert.match(source, /NoNewPrivileges=\$no_new_privileges/);
    assert.match(source, /ProtectSystem=\$protect_system/);
    assert.match(source, /if \[\[ "\$protect_system" == "full" \]\]; then/);
    assert.match(source, /ReadWritePaths=\\"\$data_dir\\"/);
    assert.match(source, /\/etc\|\/etc\/\*\|\/usr\|\/usr\/\*\|\/boot\|\/boot\/\*/);
    assert.match(source, /ReadWritePaths=\\"\$install_dir\\"/);
  }
});

test("all platform installers expose an explicit network-host option", () => {
  for (const file of ["linux.sh", "macos.sh", "windows.ps1"]) {
    const content = readFileSync(path.join(root, "install", file), "utf8");
    const publicContent = readFileSync(path.join(installerDir, file), "utf8");
    for (const source of [content, publicContent]) {
      assert.match(source, /AI_CHAT_HOST/);
      assert.match(source, /AI_CHAT_WORKER_CONCURRENCY[^\n]*25/);
      assert.match(source, /0\.0\.0\.0/);
    }
  }
});

test("linux native installer installs C/C++ build tools before pnpm install", () => {
  const content = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const published = readFileSync(path.join(installerDir, "linux.sh"), "utf8");
  for (const source of [content, published]) {
    assert.match(source, /ensure_native_build_tools/);
    assert.match(source, /build-essential/);
    const toolsAt = source.search(/ensure_native_build_tools\r?\n\(/);
    const pnpmAt = source.indexOf("pnpm install --frozen-lockfile");
    assert.ok(toolsAt >= 0 && pnpmAt > toolsAt, "build tools must be ensured before pnpm install");
  }
});

test("unix native installers build an inactive Next slot and verify browser assets", () => {
  for (const file of ["linux.sh", "macos.sh"]) {
    const content = readFileSync(path.join(root, "install", file), "utf8");
    const published = readFileSync(path.join(installerDir, file), "utf8");
    for (const source of [content, published]) {
      assert.match(source, /current_build_slot="\$\{NEXT_DIST_DIR:-\}"/);
      assert.match(source, /next_build_slot="\.next-b"/);
      assert.match(source, /bash scripts\/build-production-slot\.sh "\$next_build_slot"/);
      assert.match(source, /upsert_env_key "\$install_dir\/\.env" NEXT_DIST_DIR "\$next_build_slot"/);
      assert.match(source, /wait_for_frontend_assets "http:\/\/127\.0\.0\.1:\$port"/);
      const buildAt = source.indexOf('bash scripts/build-production-slot.sh "$next_build_slot"');
      const activateAt = source.indexOf('upsert_env_key "$install_dir/.env" NEXT_DIST_DIR "$next_build_slot"');
      assert.ok(buildAt >= 0 && activateAt > buildAt, `${file} must switch slots only after a successful build`);
    }
  }
});

test("all native installers install the Playwright Chromium browser", () => {
  for (const file of ["linux.sh", "macos.sh"]) {
    const content = readFileSync(path.join(root, "install", file), "utf8");
    const publicContent = readFileSync(path.join(installerDir, file), "utf8");
    for (const source of [content, publicContent]) {
      const dependenciesAt = source.indexOf("pnpm install --frozen-lockfile");
      const browserAt = source.indexOf("pnpm exec playwright install chromium");
      assert.ok(dependenciesAt >= 0 && browserAt > dependenciesAt, `${file} must install Chromium after dependencies`);
    }
  }
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  const publicWindows = readFileSync(path.join(installerDir, "windows.ps1"), "utf8");
  for (const source of [windows, publicWindows]) assert.match(source, /exec playwright install chromium/);
});

test("installers print the Open URL and the .env path after install", () => {
  for (const file of ["linux.sh", "macos.sh", "windows.ps1"]) {
    const content = readFileSync(path.join(root, "install", file), "utf8");
    const publicContent = readFileSync(path.join(installerDir, file), "utf8");
    for (const source of [content, publicContent]) {
      assert.match(source, /Open:/);
      assert.match(source, /You can change this\. Add:/);
      const openAt = source.lastIndexOf("Open:");
      const envHintAt = source.lastIndexOf("You can change this. Add:");
      assert.ok(openAt >= 0 && envHintAt > openAt, `${file} must print the .env hint under Open`);
    }
  }
  const docker = readFileSync(path.join(installerDir, "docker.sh"), "utf8");
  assert.match(docker, /Open: http:\/\/%s:%s/);
  assert.match(docker, /You can change this\. Add: %s/);
});

test("the release script publishes every installer option", () => {
  const release = readFileSync(path.join(root, "scripts", "release.sh"), "utf8");
  assert.match(release, /metis-docker-install\.sh/);
  assert.match(release, /metis-install\.sh/);
  assert.match(release, /metis-install\.ps1/);
  assert.match(release, /metis-linux\.sh/);
  assert.match(release, /metis-macos\.sh/);
  assert.match(release, /metis-windows\.ps1/);
  assert.match(release, /raw\.githubusercontent\.com\/\$\{repo\}\/master\/install\.sh/);
  assert.match(release, /raw\.githubusercontent\.com\/\$\{repo\}\/master\/install\.ps1/);
  assert.match(release, /ghcr\.io\/f1shyondrugs\/metis-ai/);
  assert.match(release, /--docker/);
  assert.doesNotMatch(release, /github\.com\/\$\{owner\}\/metis-ai\/releases/);
});

test("unix bootstrap remaps the v1.0.0 install base to current master scripts", () => {
  const bootstrap = readFileSync(path.join(root, "install.sh"), "utf8");
  const published = readFileSync(path.join(installerDir, "install.sh"), "utf8");
  for (const source of [bootstrap, published]) {
    assert.match(source, /raw\.githubusercontent\.com\/f1shyondrugs\/metis-ai\/v1\.0\.0/);
    assert.match(source, /base="https:\/\/raw\.githubusercontent\.com\/f1shyondrugs\/metis-ai\/master"/);
  }
});

test("unix bootstrap downloads a file then execs it instead of running from a pipe", () => {
  const bootstrap = readFileSync(path.join(root, "install.sh"), "utf8");
  assert.match(bootstrap, /metis_install\(\)/);
  assert.match(bootstrap, /mktemp/);
  assert.match(bootstrap, /exec \/bin\/bash "\$tmp"/);
  assert.match(bootstrap, /\/bin\/bash -c "\$\(curl/);
  assert.doesNotMatch(bootstrap, /\| bash -s/);
});

test("windows bootstrap has no param\(\) so irm \| iex is valid", () => {
  const bootstrap = readFileSync(path.join(root, "install.ps1"), "utf8");
  assert.equal(/^\s*param\s*\(/m.test(bootstrap), false);
  assert.match(bootstrap, /Invoke-WebRequest/);
  assert.match(bootstrap, /-File \$dest/);
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  assert.match(windows, /^\s*param\s*\(/m);
  assert.match(windows, /must be invoked with powershell -File/);
});

test("remote Windows client installer verifies Node safely and waits for authentication", () => {
  const installer = readFileSync(path.join(installerDir, "remote-client.ps1"), "utf8");
  const client = readFileSync(path.join(installerDir, "remote-client.mjs"), "utf8");
  assert.match(installer, /parseInt\(process\.versions\.node, 10\)/);
  assert.doesNotMatch(installer, /process\.versions\.node\.split\(\.\)/);
  assert.match(installer, /did not confirm a connection/);
  assert.match(installer, /\bauthenticated\b/);
  assert.match(client, /message\.type === "authenticated"/);
  assert.match(client, /log\("authenticated"/);
});

test("platform installers collect configuration before side effects and support dry-run", () => {
  for (const file of ["linux.sh", "macos.sh"]) {
    const content = readFileSync(path.join(root, "install", file), "utf8");
    assert.doesNotMatch(content, /Initial (username|login)|Initial password|ask_secret|password-file/);
    assert.match(content, /--dry-run/);
    assert.match(content, /run-service\.sh/);
 assert.match(content, /first-run UI|without account prompts|Install Metis AI without account prompts/);
    const dryRunAt = content.indexOf("if (( dry_run ))");
    const cloneAt = content.indexOf("git clone");
    assert.ok(dryRunAt >= 0 && cloneAt > dryRunAt, `${file} must dry-run before clone`);
  }
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  assert.match(windows, /\$DryRun/);
  assert.match(windows, /run-service\.ps1/);
});

test("interactive installers ask for the install directory before making changes", () => {
  const linux = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const macos = readFileSync(path.join(root, "install", "macos.sh"), "utf8");
  const docker = readFileSync(path.join(installerDir, "docker.sh"), "utf8");
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");

  for (const source of [linux, macos]) {
    assert.ok(source.includes('read_tty_line "Installation directory [$install_dir]: "'));
    assert.ok(source.includes("if (( non_interactive == 0 )); then"));
    const promptAt = source.indexOf('read_tty_line "Installation directory [$install_dir]: "');
    const cloneAt = source.indexOf('git clone "$REPO_URL" "$install_dir"');
    assert.ok(promptAt >= 0 && cloneAt > promptAt, "the path prompt must run before cloning");
  }

  assert.ok(docker.includes('read_tty_line "Installation directory [$INSTALL_DIR]: "'));
  assert.ok(docker.includes("if (( NON_INTERACTIVE == 0 )); then"));
  assert.ok(
    docker.indexOf('read_tty_line "Installation directory [$INSTALL_DIR]: "') <
      docker.indexOf('mkdir -p "$INSTALL_DIR"'),
    "the Docker path prompt must run before directories are created",
  );
  assert.ok(windows.includes('$InstallDir = Ask "Installation directory" $InstallDir'));
});

test("installers honor an explicit install directory in non-interactive dry-runs", () => {
  const customDir = path.join(os.tmpdir(), "metis-custom-install");
  for (const file of ["linux.sh", "macos.sh"]) {
    const output = execFileSync(
      "/bin/bash",
      [path.join(root, "install", file), "--non-interactive", "--dry-run", "--install-dir", customDir],
      { encoding: "utf8" },
    );
    assert.ok(output.includes(`install dir:   ${customDir}`));
    assert.ok(output.includes(`data dir:      ${path.join(customDir, "data")}`));
  }
});

test("installers detect an existing Metis install from OS services", () => {
  const linux = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const macos = readFileSync(path.join(root, "install", "macos.sh"), "utf8");
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  const docker = readFileSync(path.join(root, "public", "install", "docker.sh"), "utf8");
  assert.match(linux, /systemctl cat "\$\{service_name\}\.service"/);
  assert.match(linux, /Choice \[u\/r\/n\/a\]/);
  assert.match(linux, /--replace-existing/);
  assert.match(linux, /already installed as \$\{service_name\}\.service/);
  assert.match(macos, /LaunchAgents\/\$\{service_name\}-app\.plist/);
  assert.match(macos, /Choice \[u\/r\/n\/a\]/);
  assert.match(windows, /CurrentVersion\\Run/);
  assert.match(windows, /Choice \[u\/r\/n\/a\]/);
  assert.match(docker, /systemctl cat metis-ai\.service/);
  assert.match(docker, /--replace-existing/);
  assert.doesNotMatch(linux, /if \[\[ -f "\$dir\/uninstall\.sh" \]\]/);
  assert.doesNotMatch(linux, /bash "\$uninstaller" --install-dir/);
  assert.match(linux, /metis-keep-data/);
  assert.match(linux, /stash_nested_data/);
  assert.match(linux, /stop_linux_units/);
  assert.doesNotMatch(macos, /if \[\[ -f "\$dir\/uninstall-macos\.sh" \]\]/);
  assert.match(macos, /metis-keep-data/);
  assert.match(windows, /Uninstall-DetectedInstall/);
  assert.match(windows, /metis-keep-data/);
  assert.doesNotMatch(docker, /existing_native_dir:-\}\/uninstall\.sh/);
  assert.match(docker, /Stopping native Metis AI/);
  const uninstall = readFileSync(path.join(root, "install", "uninstall.sh"), "utf8");
  assert.match(uninstall, /discover_install_dir/);
  assert.match(uninstall, /WorkingDirectory/);
  assert.match(uninstall, /stash_nested_keep_data/);
  assert.match(uninstall, /metis-keep-data/);
  assert.doesNotMatch(uninstall, /--install-dir is required/);
  const detectAt = linux.indexOf("systemctl cat");
  const cloneAt = linux.indexOf("git clone");
  assert.ok(detectAt >= 0 && cloneAt > detectAt, "linux service detection must run before clone");
});

test("windows installer installs pnpm into the install directory instead of Program Files", () => {
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  assert.match(windows, /Get-PnpmCommand/);
  assert.match(windows, /--prefix \$runtimePrefix pnpm@9 \| Out-Null/);
  assert.doesNotMatch(windows, /corepack prepare pnpm/);
});

test("windows services start with an absolute node path and short cmd wrappers", () => {
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  const uninstall = readFileSync(path.join(root, "install", "uninstall.ps1"), "utf8");
  assert.match(windows, /METIS_NODE_BIN=/);
  assert.match(windows, /\$env:METIS_NODE_BIN/);
  assert.match(windows, /run-\$suffix\.cmd/);
  assert.match(windows, /HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run/);
  assert.match(windows, /Start-Process/);
  assert.match(windows, /for \(\$attempt = 0; \$attempt -lt 45;/);
  assert.doesNotMatch(windows, /throw "Failed to create scheduled task/);
  assert.match(uninstall, /Remove-ItemProperty/);
  assert.match(uninstall, /Stop-Process/);
  assert.match(uninstall, /cmd\.exe \/c "schtasks \/Delete/);
  assert.match(uninstall, /function Remove-Tree/);
});

test("installers merge a previous .env on replace and upgrade", () => {
  const linux = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const macos = readFileSync(path.join(root, "install", "macos.sh"), "utf8");
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  const uninstall = readFileSync(path.join(root, "install", "uninstall.sh"), "utf8");
  const uninstallMac = readFileSync(path.join(root, "install", "uninstall-macos.sh"), "utf8");
  const uninstallWin = readFileSync(path.join(root, "install", "uninstall.ps1"), "utf8");
  const docker = readFileSync(path.join(root, "public", "install", "docker.sh"), "utf8");
  for (const source of [linux, macos]) {
    assert.match(source, /preserve_existing_env/);
    assert.match(source, /merge_preserved_env/);
    assert.match(source, /metis-keep-env/);
    assert.match(source, /old values kept, new keys added/);
    const preserveAt = source.indexOf('preserve_existing_env "$dir"');
    const rmAt = source.indexOf('rm -rf -- "$dir"');
    assert.ok(preserveAt >= 0 && rmAt > preserveAt, "env must be copied before the install directory is removed");
    const writeAt = source.indexOf('} > "$install_dir/.env"');
    const mergeAt = source.lastIndexOf('merge_preserved_env "$install_dir/.env"');
    assert.ok(writeAt >= 0 && mergeAt > writeAt, "merge must run after writing the new .env template");
    const applyAt = source.lastIndexOf('apply_merged_runtime_ports "$install_dir/.env"');
    assert.ok(applyAt > mergeAt, "health-check ports must be re-read after env merge");
    const pickAt = source.lastIndexOf('mcp_port="$(pick_free_port "$mcp_port")"');
    const stopAt = source.indexOf("uninstall_detected_install");
    assert.ok(pickAt > stopAt, "MCP port must be chosen after stopping a replaced install");
  }
  assert.match(windows, /Save-ExistingEnv/);
  assert.match(windows, /Merge-PreservedEnv/);
  assert.match(windows, /metis-keep-env/);
  assert.match(uninstall, /stash_keep_env/);
  assert.match(uninstall, /metis-keep-env/);
  assert.match(uninstallMac, /stash_keep_env/);
  assert.match(uninstallWin, /metis-keep-env/);
  assert.match(docker, /if \[\[ ! -f "\$ENV_FILE" \]\]/);

  const awkFrom = (source: string) => {
    const begin = source.indexOf("# METIS_ENV_MERGE_BEGIN");
    const end = source.indexOf("# METIS_ENV_MERGE_END");
    assert.ok(begin >= 0 && end > begin, "env merge awk markers");
    const block = source.slice(begin, end);
    const match = block.match(/awk -v preserved="\$preserved" '([\s\S]*)' "\$dest"/);
    assert.ok(match, "env merge awk program");
    return match[1];
  };
  const awkProgram = awkFrom(linux);
  assert.equal(awkFrom(macos), awkProgram);

  const dir = mkdtempSync(path.join(os.tmpdir(), "metis-env-merge-"));
  try {
    const oldPath = path.join(dir, "old.env");
    const newPath = path.join(dir, "new.env");
    writeFileSync(
      oldPath,
      [
        'AI_CHAT_SECRETS_KEY="oldsecret"',
        'MCP_BEARER_TOKEN="oldtoken"',
        'CUSTOM_KEY="keepme"',
        'CHAT_DATA_DIR="/old/data"',
        'PORT="3200"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      newPath,
      [
        'AI_CHAT_SECRETS_KEY="newsecret"',
        'MCP_BEARER_TOKEN="newtoken"',
        'CHAT_DATA_DIR="/new/data"',
        'PORT="3100"',
        'NEW_KEY="added"',
        'AI_CHAT_ROOT="/new/root"',
        "",
      ].join("\n"),
    );
    const merged = execFileSync("awk", ["-v", `preserved=${oldPath}`, awkProgram, newPath], { encoding: "utf8" });
    assert.match(merged, /AI_CHAT_SECRETS_KEY="oldsecret"/);
    assert.match(merged, /MCP_BEARER_TOKEN="oldtoken"/);
    assert.match(merged, /CUSTOM_KEY="keepme"/);
    assert.match(merged, /CHAT_DATA_DIR="\/new\/data"/);
    assert.match(merged, /PORT="3200"/);
    assert.match(merged, /NEW_KEY="added"/);
    assert.match(merged, /AI_CHAT_ROOT="\/new\/root"/);
    assert.doesNotMatch(merged, /newsecret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("README documents the bootstrap one-liner rather than curling platform scripts into bash", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /\/bin\/bash -c "\$\(curl -fsSL https:\/\/raw\.githubusercontent\.com\/f1shyondrugs\/metis\/master\/install\.sh\)"/);
  assert.match(readme, /irm https:\/\/raw\.githubusercontent\.com\/f1shyondrugs\/metis\/master\/install\.ps1 \| iex/);
  assert.doesNotMatch(readme, /install\/linux\.sh \| bash/);
  assert.doesNotMatch(readme, /install\/macos\.sh \| bash/);
  assert.doesNotMatch(readme, /install\/windows\.ps1 \| iex/);
});

test("unix bootstrap routes uninstall to the platform uninstaller", () => {
  const bootstrap = readFileSync(path.join(root, "install.sh"), "utf8");
  const published = readFileSync(path.join(installerDir, "install.sh"), "utf8");
  for (const source of [bootstrap, published]) {
    assert.match(source, /uninstall --yes --keep-data/);
    assert.match(source, /\[\[ "\$\{1:-\}" == "uninstall" \]\]/);
    assert.match(source, /install\/macos\.sh "\$@"/);
    assert.match(source, /install\/linux\.sh "\$@"/);
  }
  const windows = readFileSync(path.join(root, "install.ps1"), "utf8");
  assert.match(windows, /ToLowerInvariant\(\) -eq "uninstall"/);
  assert.match(windows, /install\/windows\.ps1/);
});

test("uninstall is refused when Metis is not installed", () => {
  const linux = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const macos = readFileSync(path.join(root, "install", "macos.sh"), "utf8");
  const uninstall = readFileSync(path.join(root, "install", "uninstall.sh"), "utf8");
  assert.match(linux, /Nothing to uninstall/);
  assert.match(linux, /\[n\] Uninstall and exit/);
  assert.match(macos, /Nothing to uninstall/);
  assert.match(macos, /\[n\] Uninstall and exit/);
  assert.match(uninstall, /Metis AI is not installed as \$\{SERVICE_NAME\}\.service/);
});

test("platform installers accept uninstall and pin a release with --version", () => {
  const linux = readFileSync(path.join(root, "install", "linux.sh"), "utf8");
  const macos = readFileSync(path.join(root, "install", "macos.sh"), "utf8");
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  for (const source of [linux, macos]) {
    assert.match(source, /linux\.sh uninstall|macos\.sh uninstall/);
    assert.match(source, /\[\[ "\$\{1:-\}" == "uninstall" \]\]/);
    assert.match(source, /--version\) \[\[ \$# -ge 2 \]\]/);
    assert.match(source, /git -C "\$install_dir" checkout --force "\$update_ref"/);
  }
  assert.match(linux, /run_privileged systemctl enable "\$\{service_name\}\.service"/);
  assert.match(linux, /run_privileged systemctl restart "\$\{service_name\}\.service"/);
  const enableAt = linux.indexOf("run_privileged systemctl enable \"${service_name}.service\"");
  const restartAt = linux.indexOf("run_privileged systemctl restart \"${service_name}.service\"");
  assert.ok(enableAt >= 0 && restartAt > enableAt, "linux must restart units after enable so upgrades load the new build");
  assert.match(windows, /\$Command -eq "uninstall"/);
  assert.match(windows, /\[string\]\$Version/);
  assert.match(windows, /git -C \$InstallDir checkout --force \$updateRef/);
});

test("native installers synchronize provider CLIs after locked dependencies", () => {
  for (const file of ["linux.sh", "macos.sh", "windows.ps1"]) {
    const source = readFileSync(path.join(root, "install", file), "utf8");
    const dependencyAt = source.indexOf("install --frozen-lockfile");
    const syncAt = source.indexOf("scripts/sync-provider-clis.mjs");
    assert.ok(dependencyAt >= 0 && syncAt > dependencyAt, `${file} must sync CLIs after dependencies`);
  }
  const script = readFileSync(path.join(root, "scripts", "sync-provider-clis.mjs"), "utf8");
  assert.match(script, /const pinned = previous\?\.tracking === "pinned"/);
  assert.match(script, /if \(id !== "codex" && !previous\) return/);
  assert.match(script, /updateIfInstalled\("cursor-agent"\)/);
});

test("linux and macos installers start when HOME is unset", () => {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH || "/usr/bin:/bin", NODE_ENV: "test" };
  for (const file of ["linux.sh", "macos.sh"]) {
    const output = execFileSync("/bin/bash", [path.join(root, "install", file), "--help"], {
      encoding: "utf8",
      env,
    });
    assert.match(output, /Usage:/);
  }
});

test("docker compose publishes host bind from .env and does not pin MCP to localhost", () => {
  const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
  assert.match(compose, /\$\{AI_CHAT_HOST:-127\.0\.0\.1\}:\$\{PORT:-3100\}:3100/);
  assert.match(compose, /AI_CHAT_INTERNAL_ORIGIN: http:\/\/app:3100/);
  assert.match(compose, /MCP_HOST: "0\.0\.0\.0"/);
  assert.match(compose, /MCP_PUBLIC_URL: http:\/\/mcp:8787/);
  assert.match(compose, /condition: service_healthy/);
  assert.doesNotMatch(compose, /127\.0\.0\.1:\$\{MCP_PORT/);
});

test("docker installer writes reload.sh and honors AI_CHAT_HOST", () => {
  const docker = readFileSync(path.join(installerDir, "docker.sh"), "utf8");
  assert.match(docker, /reload\.sh/);
  assert.match(docker, /force-recreate/);
  assert.match(docker, /upsert_env AI_CHAT_HOST/);
  assert.match(docker, /AI_CHAT_INTERNAL_ORIGIN: http:\/\/app:3100/);
  assert.match(docker, /MCP_HOST: "0\.0\.0\.0"/);
  assert.match(docker, /Apply: %s/);
  assert.match(docker, /\$\{AI_CHAT_HOST:-127\.0\.0\.1\}:\$\{PORT:-3100\}:3100/);
  assert.doesNotMatch(docker, /127\.0\.0\.1:\$\{MCP_PORT:-8787\}:8787/);
});

test("platform docker installers write a reload helper after .env edits", () => {
  for (const file of ["linux.sh", "macos.sh"]) {
    const content = readFileSync(path.join(root, "install", file), "utf8");
    const published = readFileSync(path.join(installerDir, file), "utf8");
    for (const source of [content, published]) {
      assert.match(source, /write_docker_reload/);
      assert.match(source, /Apply: %s/);
      assert.match(source, /force-recreate/);
    }
  }
  const windows = readFileSync(path.join(root, "install", "windows.ps1"), "utf8");
  assert.match(windows, /reload\.ps1/);
  assert.match(windows, /force-recreate/);
});

test("MCP gateway listens on MCP_HOST and defaults to 0.0.0.0 in Docker", () => {
  const gateway = readFileSync(path.join(root, "lib", "mcp-core", "gateway-core.mjs"), "utf8");
  assert.match(gateway, /LISTEN_HOST = env\("MCP_HOST"/);
  assert.match(gateway, /isDockerEnv\(\) \? "0\.0\.0\.0" : "127\.0\.0\.1"/);
  assert.match(gateway, /httpServer\.listen\(PORT, LISTEN_HOST/);
  assert.doesNotMatch(gateway, /httpServer\.listen\(PORT, "127\.0\.0\.1"/);
});
