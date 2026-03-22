#!/usr/bin/env bash
# Build and push both images to ghcr.io as :latest, then delete orphaned SHA digests.
# Usage: ./scripts/build-push.sh
# Requires: docker, gh (GitHub CLI, authenticated), jq
set -euo pipefail

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

# Delete untagged (orphaned SHA) versions left over from previous pushes.
cleanup_untagged() {
  local pkg="$1"
  local ids
  ids=$(gh api --paginate "/users/${GH_USER}/packages/container/${pkg}/versions" \
    | jq -r '.[] | select(.metadata.container.tags | length == 0) | .id')
  if [ -z "$ids" ]; then
    echo "    No untagged versions to clean up for ${pkg}"
    return
  fi
  while IFS= read -r vid; do
    gh api --method DELETE "/users/${GH_USER}/packages/container/${pkg}/versions/${vid}" \
      && echo "    Deleted untagged version ${vid}"
  done <<< "$ids"
}

echo "==> Cleaning up orphaned image digests..."
cleanup_untagged "palpal-frontend"
cleanup_untagged "palpal-conductor"

echo "==> Done. v${VERSION}"
