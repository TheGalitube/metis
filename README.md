# J.A.R.V.I.S. Mk3.1

Self-hosted agent workspace for the existing J.A.R.V.I.S. Mk3 core. This public repository is a fork of [Metis](https://github.com/f1shyondrugs/metis). The Jarvis changes began at Metis commit `e95b94d3844da52db263c2f89d3068796c3cb787` and were merged with the newer upstream master when this fork was created. Metis Git history and its MIT license are retained; the original README is archived in [docs/METIS-UPSTREAM-README.md](docs/METIS-UPSTREAM-README.md).

Mk3.1 uses the Metis Next.js workspace, worker and MCP gateway. The original [Jarvis Mk3](https://github.com/Galitube-Developement/Jarvis-Mk3) remains a separate Python service with its own SQLite database, task queue, approval policy and Codex/Hermes credentials. An optional, server-side MCP bridge provides limited health and task operations; see [docs/JARVIS-BRIDGE.md](docs/JARVIS-BRIDGE.md). The two databases are not merged.

## Ubuntu install from the published image

The public `ghcr.io/thegalitube/jarvis-mk3.1:latest` image lets an Ubuntu server run Mk3.1 without a source checkout. It runs the app, worker, and MCP gateway as three Compose services. Follow [docs/JARVIS-IMAGE-UBUNTU.md](docs/JARVIS-IMAGE-UBUNTU.md) for installation, backup, and upgrades. The image is currently published from the separate [Jarvis-Mk3.1](https://github.com/TheGalitube/Jarvis-Mk3.1) repository; commits in this fork do not automatically rebuild that image.

## Linux install from source

Clone this public fork on the Linux host. Docker Engine with Compose v2 is required. Keep the checkout, its data directory and its workspace under a dedicated non-root service account. Ports default to loopback; the MCP gateway is reachable only inside the Compose network.

```bash
git clone https://github.com/TheGalitube/metis.git jarvis-mk3-1
cd jarvis-mk3-1
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

`3.1.0` is the Mk3.1 source version. The public GHCR image is available and has been started on an Ubuntu server. This fork's merged source passed the GitHub CI typecheck, release tests, Linux installer checks, Docker build, and container smoke tests. No GitHub Release has been published for this fork. Image deployments continue to use the separate image repository described above.

Metis and its contributors retain the copyright and license notices in [LICENSE](LICENSE). See [docs/README.md](docs/README.md), [SECURITY.md](SECURITY.md), and [docs/METIS-UPSTREAM-README.md](docs/METIS-UPSTREAM-README.md) for inherited architecture and security details.
