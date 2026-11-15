#!/bin/bash
# Read-only: OAuth2 clients registered on the TrueConf server (panel/service apps).
set -u
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }

echo "== oauth.client columns =="
q "select column_name||' '||data_type from information_schema.columns where table_schema='oauth' and table_name='client' order by ordinal_position"
echo
echo "== clients (secret truncated) =="
q "select id, name, grant_types, left(secret, 12)||'...' as secret_head, scopes from oauth.client limit 20" 2>/dev/null \
  || q "select * from oauth.client limit 5"
