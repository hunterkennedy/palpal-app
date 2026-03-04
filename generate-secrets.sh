#!/usr/bin/env sh
# Generates secrets and writes .env from .env.example.
# Safe to re-run: exits if .env already exists unless --force is passed.
#
# NOTE: POSTGRES_PASSWORD is left as "changeme" for local dev.
# Change it manually before deploying to production.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
ENV_FILE="$SCRIPT_DIR/.env"

if [ -f "$ENV_FILE" ] && [ "$1" != "--force" ]; then
    echo "Error: $ENV_FILE already exists. Pass --force to overwrite." >&2
    exit 1
fi

# Generate secrets
BLURB_KEY="$(openssl rand -hex 32)"

sed \
    -e "s|BLURB_API_KEY=changeme-blurb-secret|BLURB_API_KEY=$BLURB_KEY|" \
    "$ENV_EXAMPLE" > "$ENV_FILE"

echo "Generated $ENV_FILE"
echo "  BLURB_API_KEY = $BLURB_KEY"
echo ""
echo "NOTE: POSTGRES_PASSWORD is still 'changeme' — update it before deploying to prod."
