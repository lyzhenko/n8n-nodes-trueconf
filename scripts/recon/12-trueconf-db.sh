#!/bin/bash
# Read-only: list TrueConf databases and user accounts (production server — no writes).
set -u
PSQL=/opt/trueconf/server/bin/database/psql
[ -x "$PSQL" ] || PSQL=$(command -v psql)
echo "psql: $PSQL"

run_psql() {
	sudo -u postgres "$PSQL" -p 5444 -t -A "$@" 2>&1
}

echo "== databases =="
run_psql -c "select datname from pg_database where datistemplate = false"

echo "== tables in trueconf =="
run_psql -d trueconf -c "select table_name from information_schema.tables where table_schema='public' order by table_name" | head -50

echo "== user-like tables =="
run_psql -d trueconf -c "select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%user%' or table_name ilike '%account%')" | head -20
