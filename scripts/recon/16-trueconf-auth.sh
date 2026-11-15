#!/bin/bash
# Read-only: all TrueConf accounts and password-auth variants for eladm.
set -u
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }

echo "== all accounts (login | display | type | disabled) =="
q "select u.login, u.display_name, t.name, u.disabled_at is not null from main.users u left join main.users_type t on t.uuid = u.type order by u.created_at"
echo "== user types =="
q "select uuid, name from main.users_type order by name"

echo "== auth attempts =="
for login in "eladm" "eladm@example.trueconf.name" "example.trueconf.name\\eladm"; do
	code=$(curl -s -o /tmp/tc_auth.out -w '%{http_code}' -X POST http://127.0.0.1:4309/bridge/api/client/v1/oauth/token \
		-H 'content-type: application/json' \
		-d "{\"client_id\":\"chat_bot\",\"grant_type\":\"password\",\"username\":\"$login\",\"password\":\"${TRUECONF_PASS:-}\"}")
	echo "$login -> HTTP $code $(head -c 200 /tmp/tc_auth.out)"
done
