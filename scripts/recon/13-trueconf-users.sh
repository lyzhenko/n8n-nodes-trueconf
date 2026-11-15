#!/bin/bash
# Read-only: TrueConf users and chats from the tcs database (production server, SELECT only).
set -u
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }

echo "== tables =="
q "select table_name from information_schema.tables where table_schema='public' order by table_name" | head -60

echo "== user tables =="
q "select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%user%' or table_name ilike '%member%' or table_name ilike '%account%')"

echo "== sample users =="
q "select id, login, display_name, is_active from users limit 20" 2>/dev/null || \
q "select * from users limit 3" 2>/dev/null || echo "(users table shape unknown)"
