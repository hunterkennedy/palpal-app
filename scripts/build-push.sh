#!/usr/bin/env bash
# Build and push both images to ghcr.io, tagged with the version and :latest.
# Usage: ./scripts/build-push.sh [version]
# Requires: docker (logged into ghcr.io)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="ghcr.io/hunterkennedy"

CURRENT=$(cat "${REPO_ROOT}/VERSION")

MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)
DEFAULT="${MAJOR}.${MINOR}.$((PATCH + 1))"

INPUT="${1:-}"
if [ -z "${INPUT}" ]; then
  read -rp "Version [${DEFAULT}]: " INPUT
fi
VERSION="${INPUT:-$DEFAULT}"

echo "$VERSION" > "${REPO_ROOT}/VERSION"
echo "==> Building palpal v${VERSION}..."

docker build \
  --build-arg APP_VERSION="${VERSION}" \
  -t "${REGISTRY}/palpal-frontend:${VERSION}" \
  -t "${REGISTRY}/palpal-frontend:latest" \
  "${REPO_ROOT}/palpal-frontend"

docker build \
  -t "${REGISTRY}/palpal-conductor:${VERSION}" \
  -t "${REGISTRY}/palpal-conductor:latest" \
  "${REPO_ROOT}/palpal-conductor"

echo "==> Pushing to ghcr.io..."
for TAG in "${VERSION}" latest; do
  docker push "${REGISTRY}/palpal-frontend:${TAG}"
  docker push "${REGISTRY}/palpal-conductor:${TAG}"
done

echo "==> Done. v${VERSION} (tags: ${VERSION}, latest)"
