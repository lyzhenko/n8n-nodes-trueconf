#!/bin/bash
# Read-only + one official API call: obtain a server-wide OAuth2 token using the built-in
# "TrueConf Server Users" client, then check /api/v4/me and the user list.
set -u
PSQL=/opt/trueconf/server/bin/database/psql
row=$(sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c \
  "select code, secret from oauth.client where code = 'trueconf_server_users' limit 1")
CLIENT_ID=${row%%|*}
CLIENT_SECRET=${row#*|}
if [ -z "${CLIENT_ID:-}" ] || [ -z "${CLIENT_SECRET:-}" ]; then
	echo "client not found"
	exit 1
fi
echo "client_id: ${CLIENT_ID}"

TOKEN=$(curl -s -X POST http://127.0.0.1/api/v4/oauth2/token \
  -H 'content-type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\"}")
echo "token response: $(echo "$TOKEN" | head -c 300)"

ACCESS=$(echo "$TOKEN" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -z "$ACCESS" ]; then
	echo "no access token"
	exit 1
fi

echo "== /api/v4/me =="
curl -s http://127.0.0.1/api/v4/me -H "Authorization: Bearer $ACCESS" | head -c 500
echo
echo "== /api/v4/users (first 3) =="
curl -s "http://127.0.0.1/api/v4/users?page_size=3" -H "Authorization: Bearer $ACCESS" | head -c 800
echo
