# J.A.R.V.I.S. Mk3.1

Private, self-hosted agent workspace for the existing J.A.R.V.I.S. Mk3 core. This repository is based on [Metis](https://github.com/f1shyondrugs/metis) at commit `e95b94d3844da52db263c2f89d3068796c3cb787` (23 September 2026). Its Git history and MIT license are retained; the original README is archived in [docs/METIS-UPSTREAM-README.md](docs/METIS-UPSTREAM-README.md).

Mk3.1 uses the Metis Next.js workspace, worker and MCP gateway. The original [Jarvis Mk3](https://github.com/Galitube-Developement/Jarvis-Mk3) remains a separate Python service with its own SQLite database, task queue, approval policy and Codex/Hermes credentials. An optional, server-side MCP bridge provides limited health and task operations; see [docs/JARVIS-BRIDGE.md](docs/JARVIS-BRIDGE.md). The two databases are not merged.

## Ubuntu install from the published image

The public GHCR image lets an Ubuntu server pull and run Mk3.1 without GitHub SSH access or a source checkout. It runs the app, worker, and MCP gateway as three Compose services. Follow [docs/JARVIS-IMAGE-UBUNTU.md](docs/JARVIS-IMAGE-UBUNTU.md) for the root-user install, SSH tunnel, backup, and upgrade steps. The image becomes available for anonymous pulls after the first successful CI publication and the package is made public in GitHub Packages.

## Linux install from source

Use an authenticated checkout of this private repository on the Linux host. Docker Engine with Compose v2 is required. Keep this checkout, its data directory and its workspace under a dedicated non-root service account. Ports default to loopback; the MCP gateway is reachable only inside the Compose network.

```bash
git clone https://github.com/TheGalitube/Jarvis-Mk3.1.git
cd Jarvis-Mk3.1
bash deploy/install-jarvis-linux.sh --dry-run
bash deploy/install-jarvis-linux.sh
```

The script builds this source locally, generates strong application and MCP secrets in a mode-`0600` `.env`, starts the app, worker and MCP services, and checks the web endpoint. Finish first-user setup through `http://127.0.0.1:3100/` on the host, or use SSH port forwarding. Do not expose the app or gateway directly to the public Internet. See [docs/JARVIS-LINUX.md](docs/JARVIS-LINUX.md) for prerequisites, bridge setup, backup, upgrades and verification.

The Metis `releases/latest/download/metis-docker-install.sh` URL from upstream is **not** a Mk3.1 installer. A future upstream image would omit this repository's changes. Mk3.1 self-update remains disabled until its upgrade path is tested.

## Development

Requires Node.js 22+ and pnpm 9.15.4. Copy `.env.example` to `.env`, replace all placeholder secrets, then run:

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
```

The workspace defaults to `127.0.0.1:3100`. Provider credentials are configured in the app and encrypted using `AI_CHAT_SECRETS_KEY`. Do not commit `.env`, data, workspaces, browser profiles or credentials.

## Release status

`3.1.0` is the Mk3.1 source version. No Mk3.1 GitHub Release, GHCR image or Linux production deployment has been published or verified yet. Use the checked-out source and the Linux procedure above for a first deployment, then run the smoke checks on the actual Linux host before treating it as production-ready.

Metis and its contributors retain the copyright and license notices in [LICENSE](LICENSE). See [docs/README.md](docs/README.md), [SECURITY.md](SECURITY.md), and [docs/METIS-UPSTREAM-README.md](docs/METIS-UPSTREAM-README.md) for inherited architecture and security details.
