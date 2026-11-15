#!/bin/bash
# Read-only: inspect the TrueConf install wizard log and auth providers.
set -u
echo "== wizard.log =="
ls -la /root/.install-log/
sed -n '1,120p' /root/.install-log/wizard.log 2>/dev/null

echo
echo "== auth.providers =="
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }
q "select * from auth.providers limit 10"
echo "== auth.zones =="
q "select * from auth.zones limit 10"
echo "== users + auth zone =="
q "select u.login, u.type, u.disabled_at, u.deleted_at from main.users u where u.login not like 'trueconf_%' and u.login not in ('tcs_system','anonymous')"
