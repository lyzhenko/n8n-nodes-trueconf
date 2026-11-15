#!/bin/bash
# Official API probe over HTTP: password grant with the built-in server client.
# If TrueConf refuses ("insecureConnection") we know TLS is mandatory for API v4.
set -u
PSQL=/opt/trueconf/server/bin/database/psql
row=$(sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c \
  "select code, secret from oauth.client where code = 'trueconf_server_users' limit 1")
CLIENT_ID=${row%%|*}
CLIENT_SECRET=${row#*|}

echo "== password grant over HTTP =="
curl -s -X POST http://127.0.0.1/api/v4/oauth2/token \
  -H 'content-type: application/json' \
  -d "{\"grant_type\":\"password\",\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\",\"username\":\"eladm\",\"password\":\"${TRUECONF_PASS}\"}" | head -c 500
echo

echo "== client_credentials over HTTPS (443) =="
curl -sk -X POST https://127.0.0.1/api/v4/oauth2/token \
  -H 'content-type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\"}" | head -c 300
echo

echo "== web server TLS config hints =="
grep -riE "ssl|443|certificate" /opt/trueconf/server/etc/webmanager/*.conf 2>/dev/null | head -12
ls /opt/trueconf/server/etc/webmanager 2>/dev/null | head -20
