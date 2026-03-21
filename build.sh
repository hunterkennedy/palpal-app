#!/usr/bin/env bash
set -euo pipefail

VERSION=$(cat VERSION)
REGISTRY="ghcr.io/hunterkennedy"

echo "Building palpal v${VERSION}..."

docker build \
  --build-arg APP_VERSION="${VERSION}" \
  -t "${REGISTRY}/palpal-frontend:${VERSION}" \
  -t "${REGISTRY}/palpal-frontend:latest" \
  ./palpal-frontend

docker build \
  -t "${REGISTRY}/palpal-conductor:${VERSION}" \
  -t "${REGISTRY}/palpal-conductor:latest" \
  ./palpal-conductor

echo "Built and tagged:"
echo "  ${REGISTRY}/palpal-frontend:${VERSION}"
echo "  ${REGISTRY}/palpal-conductor:${VERSION}"
echo ""
echo "To push:"
echo "  docker push ${REGISTRY}/palpal-frontend:${VERSION}"
echo "  docker push ${REGISTRY}/palpal-frontend:latest"
echo "  docker push ${REGISTRY}/palpal-conductor:${VERSION}"
echo "  docker push ${REGISTRY}/palpal-conductor:latest"
