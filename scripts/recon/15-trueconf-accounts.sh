#!/bin/bash
# Read-only: existing TrueConf accounts and their types (production, SELECT only).
set -u
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }

echo "== main.users columns =="
q "select column_name||' '||data_type from information_schema.columns where table_schema='main' and table_name='users' order by ordinal_position"

echo "== user count =="
q "select count(*) from main.users"

echo "== accounts =="
q "select id, login, email, display_name, is_active, type_id from main.users order by id limit 30" 2>/dev/null \
  || q "select * from main.users limit 3"
