#!/usr/bin/env bash
# Logical backup of the whole database (clients, tasks, notes, documents METADATA, history).
# Document FILES live in your S3/R2 bucket — turn on bucket versioning there for file backups.
#
#   DATABASE_URL=postgresql://... BACKUP_PASSPHRASE='long secret' scripts/backup.sh
#
# Output: backups/uva-<UTC timestamp>.sql.gz  (or .sql.gz.enc when BACKUP_PASSPHRASE is set — strongly recommended)
# Optional: BACKUP_DIR, BACKUP_KEEP (default 14 newest files kept), and S3_BUCKET + AWS CLI credentials to upload the file.
# Restore:  gunzip -c file.sql.gz | psql "$DATABASE_URL"        (decrypt first with the openssl command printed below)
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
DIR="${BACKUP_DIR:-backups}"; KEEP="${BACKUP_KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/uva-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_PASSPHRASE
  rm "$FILE"; FILE="$FILE.enc"
  echo "Decrypt with: openssl enc -d -aes-256-cbc -pbkdf2 -in $FILE -out restored.sql.gz -pass env:BACKUP_PASSPHRASE"
else
  echo "WARNING: BACKUP_PASSPHRASE not set — this backup contains client data in clear text." >&2
fi
if [ -n "${S3_BUCKET:-}" ] && command -v aws >/dev/null; then
  aws s3 cp "$FILE" "s3://$S3_BUCKET/backups/$(basename "$FILE")" ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"}
fi
ls -1t "$DIR"/uva-* 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
