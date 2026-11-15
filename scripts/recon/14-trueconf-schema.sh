#!/bin/bash
# Read-only: schemas and tables in the TrueConf tcs database.
set -u
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }

echo "== schemas =="
q "select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'"
echo "== tables (all schemas) =="
q "select schemaname||'.'||tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by 1" | head -60
echo "== tables matching user =="
q "select schemaname||'.'||tablename from pg_tables where tablename ilike '%user%' or tablename ilike '%chat%' order by 1" | head -30
