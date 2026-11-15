#!/bin/bash
# Read-only: what did n8n log around workflow activation and the TrueConf trigger?
set -u
echo "== errors in the last 15 minutes =="
journalctl -u n8n --since '-15 min' -o cat | grep -iE '"level":"error"|Unrecognized|Cannot read|TypeError|is not a function' | tail -20
echo
echo "== activation / active workflow lines =="
journalctl -u n8n --since '-15 min' -o cat | grep -iE 'activat|active-workflow|triggerCount|workflow-activated' | tail -20
echo
echo "== anything mentioning trueconf =="
journalctl -u n8n --since '-30 min' -o cat | grep -i trueconf | tail -20
echo
echo "== active workflows in DB =="
PGPASSWORD="$(cat /root/.n8n-secrets/postgres_password 2>/dev/null)" psql -h 127.0.0.1 -U n8n -d n8n -t -c \
  "select id, name, active, \"activeVersionId\" is not null as has_version from workflow_entity order by \"updatedAt\" desc limit 8;" 2>&1 | head -20
