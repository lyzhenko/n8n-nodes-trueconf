#!/bin/bash
# Read-only: what CLI options does the TrueConf server binary expose; who are admins.
set -u
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }

echo "== accounts =="
q "select u.login, u.display_name, t.name, (u.disabled_at is not null) as disabled from main.users u left join main.users_type t on t.uid = u.type order by u.created_at"
echo "== user types =="
q "select uid, name from main.users_type order by name"
echo "== admins =="
q "select * from config.admins limit 10"
echo "== vcs --help =="
timeout 5 /opt/trueconf/server/bin/vcs --help 2>&1 | head -30
echo "== other binaries =="
ls -1 /opt/trueconf/server/bin
