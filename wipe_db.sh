#!/usr/bin/env bash
set -e

CONTAINER=$(docker ps --filter name=postgres --format '{{.Names}}' | head -1)

if [[ -z "$CONTAINER" ]]; then
  echo "No running postgres container found"
  exit 1
fi

echo "Wiping DB in container: $CONTAINER"
docker exec -i "$CONTAINER" psql -U palpal -d palpal \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
echo "Done. Restart the conductor to re-run migrations."
