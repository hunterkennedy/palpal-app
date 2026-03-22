#!/usr/bin/env bash
# Build and push both images to ghcr.io as :latest, then delete orphaned SHA digests.
# Usage: ./scripts/build-push.sh
# Requires: docker, jq, GH_DEL_TOKEN env var (classic PAT with delete:packages + read:packages scope)
set -euo pipefail

if [ -z "${GH_DEL_TOKEN:-}" ]; then
  echo "Error: GH_DEL_TOKEN is not set. Export a classic PAT with delete:packages scope." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="ghcr.io/hunterkennedy"
GH_USER="hunterkennedy"

CURRENT=$(cat "${REPO_ROOT}/VERSION")

MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)
DEFAULT="${MAJOR}.${MINOR}.$((PATCH + 1))"

read -rp "Version [${DEFAULT}]: " INPUT
VERSION="${INPUT:-$DEFAULT}"

echo "$VERSION" > "${REPO_ROOT}/VERSION"
echo "==> Building palpal v${VERSION}..."

docker build \
  --build-arg APP_VERSION="${VERSION}" \
  -t "${REGISTRY}/palpal-frontend:latest" \
  "${REPO_ROOT}/palpal-frontend"

docker build \
  -t "${REGISTRY}/palpal-conductor:latest" \
  "${REPO_ROOT}/palpal-conductor"

echo "==> Pushing to ghcr.io..."
docker push "${REGISTRY}/palpal-frontend:latest"
docker push "${REGISTRY}/palpal-conductor:latest"

# Delete untagged versions that are NOT referenced as children of a tagged manifest.
# BuildKit pushes an OCI manifest index (tagged :latest) that references one or more
# untagged platform manifests — those children must not be deleted.
cleanup_untagged() {
  local pkg="$1"
  local api="https://api.github.com/users/${GH_USER}/packages/container/${pkg}"
  local reg="https://ghcr.io/v2/${GH_USER}/${pkg}"

  local all_versions
  all_versions=$(curl -fsSL \
    -H "Authorization: Bearer ${GH_DEL_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "${api}/versions?per_page=100")

  # For every tagged version, fetch its manifest from the registry and collect
  # any child digests it references (i.e. platform-specific manifests in an index).
  local protected=""
  while IFS= read -r digest; do
    [ -z "$digest" ] && continue
    local children
    children=$(curl -fsSL \
      -H "Authorization: Bearer ${GH_DEL_TOKEN}" \
      -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
      "${reg}/manifests/${digest}" 2>/dev/null \
      | jq -r '.manifests[]?.digest // empty' 2>/dev/null || true)
    [ -n "$children" ] && protected="${protected}"$'\n'"${children}"
  done < <(echo "$all_versions" | jq -r '.[] | select(.metadata.container.tags | length > 0) | .name')

  # Delete untagged versions whose digest does not appear in the protected set.
  local deleted=0
  while IFS=$'\t' read -r vid vname; do
    if [ -n "$vname" ] && echo "$protected" | grep -qF "$vname"; then
      echo "    Skipping ${vname:0:19}… (child of tagged manifest)"
    else
      curl -fsSL -X DELETE \
        -H "Authorization: Bearer ${GH_DEL_TOKEN}" \
        -H "Accept: application/vnd.github+json" \
        "${api}/versions/${vid}" \
        && echo "    Deleted ${vname:0:19}…" \
        && deleted=$((deleted + 1))
    fi
  done < <(echo "$all_versions" | jq -r '.[] | select(.metadata.container.tags | length == 0) | [.id, .name] | @tsv')

  [ "$deleted" -eq 0 ] && echo "    Nothing to clean up for ${pkg}"
}

echo "==> Cleaning up orphaned image digests..."
cleanup_untagged "palpal-frontend"
cleanup_untagged "palpal-conductor"

echo "==> Done. v${VERSION}"
