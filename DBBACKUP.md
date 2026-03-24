# Database Backup

## One-off backup

```bash
source .env
docker exec palpal-postgres pg_dump -U "$POSTGRES_USER" -F c "$POSTGRES_DB" > palpal_$(date +%Y%m%d_%H%M%S).dump
```

## Restore

```bash
source .env
docker exec -i palpal-postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" < palpal_20260318_120000.dump
```

## Scheduled backups (cron)

Create `~/backups/palpal/backup.sh`:

```bash
#!/bin/bash
set -a
source /path/to/palpal-app/.env
set +a

BACKUP_DIR=~/backups/palpal
FILENAME="$BACKUP_DIR/palpal_$(date +%Y%m%d_%H%M%S).dump"

docker exec palpal-postgres pg_dump -U "$POSTGRES_USER" -F c "$POSTGRES_DB" > "$FILENAME"

# Keep last 7 backups
ls -t "$BACKUP_DIR"/*.dump | tail -n +8 | xargs -r rm
```

```bash
chmod +x ~/backups/palpal/backup.sh
```

Add to crontab (`crontab -e`) to run daily at 2am:

```
0 2 * * * /home/hunter/backups/palpal/backup.sh >> /home/hunter/backups/palpal/backup.log 2>&1
```

## Off-site sync (recommended)

Install [rclone](https://rclone.org/) and configure a remote (S3, Backblaze B2, etc.), then add after the `pg_dump` line:

```bash
rclone copy "$FILENAME" remote:palpal-backups/
```

## Notes

- Uses custom format (`-F c`): compressed, faster to restore than plain SQL
- `pg_dump` is non-blocking — the DB stays live during backup
- The `transcripts` table (raw segments JSONB) is large but only grows — it is never queried during normal operation, so it has no impact on runtime memory
