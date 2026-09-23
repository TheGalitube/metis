# J.A.R.V.I.S. Mk3.1 on Linux

Mk3.1 is built from this private source checkout. The upstream `latest` Docker installer and GHCR image are not used. The first install script is intentionally Linux-only; this Windows development PC is not a deployment target.

## Services and boundaries

| Service | Role | Default access |
| --- | --- | --- |
| Mk3 Python Core | Existing Hermes/Codex tasks, approvals and memory | `127.0.0.1:3213` on the host |
| Mk3.1 app | Web workspace and login | `127.0.0.1:3100` on the host |
| Mk3.1 worker | Durable Metis jobs | Compose network only |
| Mk3.1 MCP gateway | Workspace tools and optional Jarvis bridge | Compose network only |

The Core and workspace have separate databases and credentials. Installing Mk3.1 never overwrites or migrates the Mk3 Core database. The bridge is disabled by default; [JARVIS-BRIDGE.md](./JARVIS-BRIDGE.md) describes the explicit integration.

## First install

Use a dedicated non-root Linux account that can run Docker Compose v2. Clone this private repository with that account. Review the checked-out commit and run:

```bash
bash deploy/install-jarvis-linux.sh --dry-run
bash deploy/install-jarvis-linux.sh
docker compose --project-name jarvis-mk3-1 ps
curl --fail http://127.0.0.1:3100/
```

The script creates `.env` with mode `0600`, random `AI_CHAT_SECRETS_KEY` and `MCP_BEARER_TOKEN`, plus `data/` and `workspace/`. It then builds a local image and waits for all three services. It refuses to run when `.env` already exists, so a repeated invocation cannot silently replace an installation. If the initial build fails after `.env` was created, inspect the error and resume with `docker compose --project-name jarvis-mk3-1 up --build -d --wait` after fixing the cause.

Open the loopback web port with an SSH tunnel, for example `ssh -L 3100:127.0.0.1:3100 <linux-host>`, and finish first-user setup. Use an authenticated TLS reverse proxy if other devices need access. The MCP port is not published on the host by the Mk3.1 Compose file.

## Core bridge

The default Core binding to `127.0.0.1:3213` is not reachable from the separate Docker network. To enable the optional bridge in Compose, provide the MCP container alone with a route to a literal private host address, bind Jarvis Core to that private interface, and restrict port 3213 with the host firewall. Mount a mode-`0600` token file read-only into the MCP service alone. Set `JARVIS_BRIDGE_ENABLED=1`, `JARVIS_BRIDGE_URL` and `JARVIS_BRIDGE_TOKEN_FILE` on that service, then enable the host-admin-only `jarvis-mk3` registry entry. The app and worker containers do not need the Jarvis token. See [JARVIS-BRIDGE.md](./JARVIS-BRIDGE.md) for the exact bridge contract and checks.

If the Core must remain loopback-only, run the Metis app, worker and MCP gateway natively under systemd on the same host using the inherited [deployment guide](./DEPLOY.md) and systemd templates; the bridge can then target `127.0.0.1:3213`. Use separate service names and data paths from the existing Mk3 Core. Do not install over `jarvis-mk3.service`.

## Backup and upgrade

Before an upgrade, stop the Mk3.1 Compose services and archive `.env`, `data/` and `workspace/` together. Keep the archive outside the checkout and restrict its permissions because it contains credentials and user data. For example:

```bash
umask 077
docker compose --project-name jarvis-mk3-1 stop
backup="$HOME/jarvis-mk3-1-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup" .env data workspace
docker compose --project-name jarvis-mk3-1 start
```

Use a reviewed Mk3.1 commit from this private repository, then rebuild locally:

```bash
git fetch origin
git switch --detach <reviewed-commit>
docker compose --project-name jarvis-mk3-1 up --build -d --wait
docker compose --project-name jarvis-mk3-1 ps
curl --fail http://127.0.0.1:3100/
```

Check a login, a harmless agent task, saved data after a restart, and the Jarvis bridge only if enabled. Do not restore an older database over a live service; stop the containers first. If a schema migration occurred, recover the matching code and data backup together. Mk3.1's in-app self-update is disabled until private release images and upgrade tests are published.

## Verification still needed on the destination host

This development environment is Windows and has no Docker daemon. Before production use, validate the Compose build on the actual Linux architecture, first-user setup, secret file ownership, app/worker/MCP health, browser tools, a real model-backed task, Core bridge permissions and restart persistence. The code-level checks in CI do not replace that end-to-end host test.
