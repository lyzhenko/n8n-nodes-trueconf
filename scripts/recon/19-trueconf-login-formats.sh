#!/bin/bash
# Read-only: try the documented login formats for the TrueConf bot endpoint.
set -u
URL=http://127.0.0.1:4309/bridge/api/client/v1/oauth/token
DOMAIN=$(hostname -f 2>/dev/null || hostname)

try() {
	local login="$1"
	local esc
	esc=$(printf '%s' "$login" | sed 's/\\/\\\\/g')
	local code
	code=$(curl -s -o /tmp/tc_auth.out -w '%{http_code}' -X POST "$URL" \
		-H 'content-type: application/json' \
		-d "{\"client_id\":\"chat_bot\",\"grant_type\":\"password\",\"username\":\"$esc\",\"password\":\"${TRUECONF_PASS}\"}")
	echo "  $login -> HTTP $code $(head -c 200 /tmp/tc_auth.out)"
}

echo "hostname -f: $DOMAIN"
echo "tests:"
try "eladm"
try "eladm@$DOMAIN"
try "eladm@192.168.0.13"
try "$DOMAIN\\eladm"
try "ELADM"

echo
echo "== auth config in DB =="
PSQL=/opt/trueconf/server/bin/database/psql
sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c \
  "select key, left(value::text, 120) from main.configs where key ilike '%auth%' or key ilike '%password%' limit 20" 2>&1 | head -20
