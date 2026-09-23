# J.A.R.V.I.S. Mk3.1 from a public Docker image on Ubuntu

This path does not clone the private source repository on the server. GitHub Actions builds the image after the `master` CI job passes and pushes `ghcr.io/thegalitube/jarvis-mk3.1:latest` and a commit-specific `sha-...` tag. The image contains the application source and dependencies. Publishing the package publicly makes that content downloadable by anyone.

**Do not run the server commands until the image has actually been published.** The first GHCR publication is private by default. The repository owner must set the container package visibility to **Public** in GitHub Packages after the first successful `publish-image` job. Confirm that an unauthenticated `docker pull ghcr.io/thegalitube/jarvis-mk3.1:latest` works before proceeding. A failed pull means the image does not exist yet or is not public; stop there.

## First install as root on Ubuntu

Install Docker Engine, Buildx, and Compose v2 using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Check `docker info`, `docker compose version`, and `uname -m`. The initial CI image is built for `linux/amd64`, so the server should report `x86_64`.

Run on the Ubuntu server:

```bash
mkdir -p /root/jarvis-mk3-1
cd /root/jarvis-mk3-1
docker pull ghcr.io/thegalitube/jarvis-mk3.1:latest
```

Only after the pull succeeds, run:

```bash
docker run --rm --entrypoint cat ghcr.io/thegalitube/jarvis-mk3.1:latest /app/deploy/compose-image.yml > compose-image.yml
docker run --rm --entrypoint cat ghcr.io/thegalitube/jarvis-mk3.1:latest /app/deploy/install-jarvis-image-linux.sh > install-jarvis-image-linux.sh
test -s compose-image.yml && test -s install-jarvis-image-linux.sh
bash install-jarvis-image-linux.sh --dry-run
bash install-jarvis-image-linux.sh
docker compose -f compose-image.yml --project-name jarvis-mk3-1 ps
curl --fail http://127.0.0.1:3100/
```

The installer writes `.env` with mode `0600`, random credentials, `data/`, and `workspace/`. It starts the app, worker, and MCP gateway from the same published image. The web port is bound only to `127.0.0.1:3100` on the server. From Windows PowerShell, run `ssh -N -L 3100:127.0.0.1:3100 root@SERVER_IP`, then visit `http://127.0.0.1:3100/` in the Windows browser for first-user setup. Do not post `.env` or the SSH private key.

## Upgrade

Back up `.env`, `data/`, and `workspace/` together before changing images. From `/root/jarvis-mk3-1`, for example:

```bash
umask 077
docker compose -f compose-image.yml --project-name jarvis-mk3-1 stop
tar -czf "/root/jarvis-mk3-1-backup-$(date +%Y%m%d-%H%M%S).tar.gz" .env data workspace
docker compose -f compose-image.yml --project-name jarvis-mk3-1 start
docker pull ghcr.io/thegalitube/jarvis-mk3.1:latest
docker run --rm --entrypoint cat ghcr.io/thegalitube/jarvis-mk3.1:latest /app/deploy/compose-image.yml > compose-image.yml
docker run --rm --entrypoint cat ghcr.io/thegalitube/jarvis-mk3.1:latest /app/deploy/install-jarvis-image-linux.sh > install-jarvis-image-linux.sh
docker compose -f compose-image.yml --project-name jarvis-mk3-1 up --no-build -d --wait
docker compose -f compose-image.yml --project-name jarvis-mk3-1 ps
```

The commands refresh the copied Compose file and installer from the new image. Do not rerun the first-install script when `.env` exists.

The Mk3.1 workspace remains separate from any existing Mk3 Core process and database. Its optional Core bridge stays disabled until it is configured according to [JARVIS-BRIDGE.md](./JARVIS-BRIDGE.md).
