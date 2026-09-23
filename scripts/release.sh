#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pnpm release vX.Y.Z[-prerelease]

Creates the tag, builds the release assets and publishes the GitHub release
and GHCR image using the locally authenticated GitHub account.
EOF
}

tag="${1:-}"
if [[ "$tag" == "-h" || "$tag" == "--help" || -z "$tag" ]]; then
  usage
  [[ -n "$tag" ]] && exit 0
  exit 2
fi

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  echo "Invalid release tag: $tag" >&2
  exit 2
}

expected_version="${tag#v}"
package_version="$(node -p 'require("./package.json").version')"
[[ "$package_version" == "$expected_version" ]] || {
  echo "package.json is $package_version but the tag is $tag" >&2
  exit 2
}

[[ "${JARVIS_RELEASE_READY:-0}" == "1" ]] || {
  echo "Mk3.1 release is blocked until the private image and Linux upgrade path are verified; set JARVIS_RELEASE_READY=1 after review." >&2
  exit 2
}

command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
gh auth status >/dev/null
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo%%/*}"
login="$(gh api user --jq .login)"
[[ "$login" == "$owner" ]] || {
  echo "GitHub login $login does not match repository owner $owner" >&2
  exit 2
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before releasing." >&2
  exit 2
fi
replace_release="${METIS_REPLACE_RELEASE:-0}"
if git rev-parse "$tag" >/dev/null 2>&1; then
  if [[ "$replace_release" == "1" ]]; then
    git tag -d "$tag"
  else
    echo "Tag already exists locally: $tag" >&2
    exit 2
  fi
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  if [[ "$replace_release" == "1" ]]; then
    git push origin ":refs/tags/$tag"
    gh release delete "$tag" --yes --cleanup-tag || true
  else
    echo "Tag already exists on origin: $tag" >&2
    exit 2
  fi
fi

echo "Running release checks as $(git config user.name) <$(git config user.email)>"
pnpm test:release
pnpm exec tsx --test tests/release-manifest.test.ts tests/github-releases.test.ts

commit="$(git rev-parse HEAD)"
METIS_RELEASE_TAG="$tag" \
METIS_RELEASE_VERSION="$expected_version" \
METIS_RELEASE_COMMIT="$commit" \
pnpm build

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/metis-release.XXXXXX")"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

version="${tag#v}"
git archive --format=tar.gz --prefix="metis-ai-${version}/" HEAD > "$work_dir/metis-ai-${tag}.tar.gz"
cp public/install/install.sh "$work_dir/metis-install.sh"
cp public/install/install.ps1 "$work_dir/metis-install.ps1"
cp public/install/docker.sh "$work_dir/metis-docker-install.sh"
cp public/install/linux.sh "$work_dir/metis-linux.sh"
cp public/install/macos.sh "$work_dir/metis-macos.sh"
cp public/install/windows.ps1 "$work_dir/metis-windows.ps1"
sha256sum "$work_dir/metis-ai-${tag}.tar.gz" "$work_dir/metis-install.sh" "$work_dir/metis-install.ps1" "$work_dir/metis-docker-install.sh" "$work_dir/metis-linux.sh" "$work_dir/metis-macos.sh" "$work_dir/metis-windows.ps1" > "$work_dir/SHA256SUMS"

image="${METIS_IMAGE_REPOSITORY:-ghcr.io/thegalitube/jarvis-mk3-1}"
gh auth token | docker login ghcr.io --username "$owner" --password-stdin >/dev/null
docker buildx build --push \
  --tag "${image}:${tag}" \
  --tag "${image}:latest" \
  --label "org.opencontainers.image.version=${tag}" \
  --label "org.opencontainers.image.revision=$commit" \
  --build-arg "METIS_RELEASE_TAG=${tag}" \
  --build-arg "METIS_RELEASE_VERSION=${tag}" \
  --build-arg "METIS_RELEASE_COMMIT=$commit" .

# Publish the tag only after the image exists; upstream v1.0.9 demonstrated why
# a tag-first release can point the installer at an unpublished image.
git tag -a "$tag" -m "J.A.R.V.I.S. Mk3.1 $tag"
git push origin HEAD:master "$tag"

notes_file="$work_dir/release-notes.md"
{
  echo "## What's new"
  echo
  awk -v ver="$version" '
    $0 ~ "^## v" ver " " {p=1; next}
    p && /^## / {exit}
    p {print}
  ' CHANGELOG.md
  cat <<EOF

## How to install

Pick the installer that matches how you want to run Metis.

### Docker (recommended for production)

\`\`\`bash
curl -fsSL https://github.com/${repo}/releases/latest/download/metis-docker-install.sh -o metis-docker-install.sh
bash metis-docker-install.sh --version ${tag}
\`\`\`

### Linux and macOS

\`\`\`bash
/bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/${repo}/master/install.sh)"
\`\`\`

From this release:

\`\`\`bash
curl -fsSL https://github.com/${repo}/releases/latest/download/metis-install.sh -o metis-install.sh
bash metis-install.sh
\`\`\`

Linux is native systemd by default. Docker: add \`-- --docker\` after the bootstrap, or run \`bash metis-linux.sh --docker\`.
On macOS, Docker is used when available; add \`-- --native\` to force Node.js + launchd.

### Windows

\`\`\`powershell
irm https://raw.githubusercontent.com/${repo}/master/install.ps1 | iex
\`\`\`

From this release:

\`\`\`powershell
irm https://github.com/${repo}/releases/latest/download/metis-install.ps1 | iex
\`\`\`

Native (no Docker): download \`metis-windows.ps1\` and run \`powershell -File .\\metis-windows.ps1 -Native\`.

### Source tarball

Download \`metis-ai-${tag}.tar.gz\`, extract it, copy \`.env.example\` to \`.env\`, then \`pnpm install && pnpm build\`.

See [CHANGELOG.md](https://github.com/${repo}/blob/${tag}/CHANGELOG.md) for the full changelog.
EOF
} > "$notes_file"

gh release create "$tag" \
  --title "J.A.R.V.I.S. Mk3.1 ${tag}" \
  --notes-file "$notes_file" \
  "$work_dir/metis-ai-${tag}.tar.gz" \
  "$work_dir/metis-install.sh" \
  "$work_dir/metis-install.ps1" \
  "$work_dir/metis-docker-install.sh" \
  "$work_dir/metis-linux.sh" \
  "$work_dir/metis-macos.sh" \
  "$work_dir/metis-windows.ps1" \
  "$work_dir/SHA256SUMS"

echo "Published ${tag} as ${owner}."
