#!/bin/bash
# Read-only: search install artifacts for the admin account/password.
set -u
echo "== wizard.log: eladm / password / admin lines =="
grep -aiE "eladm|password|admin|login" /root/.install-log/wizard.log 2>/dev/null | head -40
echo
echo "== other install-log files =="
find /root/.install-log -type f -maxdepth 3 -printf '%p %s\n' 2>/dev/null
echo
echo "== password hashes? =="
PSQL=/opt/trueconf/server/bin/database/psql
sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -c \
  "select table_schema||'.'||table_name||'.'||column_name from information_schema.columns where column_name ilike '%pass%' or column_name ilike '%hash%' or column_name ilike '%secret%'" 2>&1 | head -25
