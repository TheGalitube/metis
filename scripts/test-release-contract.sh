#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

work_dir="$(CDPATH= cd -- "$(mktemp -d "${TMPDIR:-/tmp}/metis-release-test.XXXXXX")" && pwd)"
trap 'rm -rf -- "$work_dir"' EXIT

mkdir -p "$work_dir/dist"
package_version="$(node -p 'require("./package.json").version')"
release_tag="v${package_version}"
NEXT_DIST_DIR="$work_dir/dist" \
METIS_RELEASE_TAG="$release_tag" \
METIS_RELEASE_VERSION="$package_version" \
METIS_RELEASE_COMMIT=test-commit \
pnpm exec tsx scripts/write-release-manifest.ts >/dev/null

export EXPECTED_TAG="$release_tag" EXPECTED_VERSION="$package_version"
node - "$work_dir/dist/release-manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (manifest.schemaVersion !== 1 || manifest.tag !== process.env.EXPECTED_TAG || manifest.version !== process.env.EXPECTED_VERSION) {
  throw new Error(`unexpected stable manifest: ${JSON.stringify(manifest)}`);
}
if (manifest.channel !== "stable" || manifest.isRelease !== true || manifest.commit !== "test-commit") {
  throw new Error(`unexpected release metadata: ${JSON.stringify(manifest)}`);
}
console.log("STABLE_MANIFEST_OK");
NODE

bash public/install/docker.sh \
  --version "$release_tag" \
  --install-dir "$work_dir/install" \
  --data-dir "$work_dir/data" \
  --workspace "$work_dir/workspace" \
  --dry-run | grep -F "image:     ghcr.io/thegalitube/jarvis-mk3-1:${release_tag}"
[[ ! -e "$work_dir/install/.env" && ! -e "$work_dir/install/docker-compose.yml" ]]
echo "DOCKER_DRY_RUN_OK"

if bash public/install/docker.sh --version master --install-dir "$work_dir/invalid" --dry-run >/dev/null 2>&1; then
  echo "Invalid release version was accepted" >&2
  exit 1
fi
echo "INVALID_VERSION_REJECTED"

printf 'release payload for checksum test\n' > "$work_dir/metis-ai-${release_tag}.tar.gz"
sha256sum "$work_dir/metis-ai-${release_tag}.tar.gz" > "$work_dir/SHA256SUMS"
(cd "$work_dir" && sha256sum --check SHA256SUMS)
echo "CHECKSUM_OK"
