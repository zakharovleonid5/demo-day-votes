#!/bin/bash
set -euo pipefail
umask 077
source=/var/lib/demo-day-voting/db.json
directory=/var/backups/demo-day-voting
[ -f "$source" ] || exit 0
cp "$source" "$directory/db-$(date -u +%Y%m%dT%H%M%SZ).json"
find "$directory" -maxdepth 1 -type f -name 'db-*.json' -mtime +30 -delete
