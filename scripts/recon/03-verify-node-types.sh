#!/bin/bash
# Verifies that the custom node types are registered in the running n8n instance.
# Logs in through the REST API (cookie auth) and inspects /rest/node-types.
set -u
BASE=http://127.0.0.1:5678
EMAIL="${N8N_EMAIL:-admin@example.com}"
PASS="${N8N_PASS:?set N8N_PASS}"

COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

LOGIN=$(curl -s -c "$COOKIE" -X POST "$BASE/rest/login" \
	-H 'content-type: application/json' \
	-d "{\"emailOrLdapLoginId\":\"$EMAIL\",\"password\":\"$PASS\"}" \
	-w '\n%{http_code}')

STATUS=$(echo "$LOGIN" | tail -1)
echo "login status: $STATUS"
if [ "$STATUS" != "200" ]; then
	echo "$LOGIN" | head -3
	exit 1
fi

curl -s -b "$COOKIE" "$BASE/rest/node-types" > /tmp/node-types.json
echo "node-types payload: $(wc -c < /tmp/node-types.json) bytes"

/opt/node/bin/node -e '
const fs = require("fs");
const raw = JSON.parse(fs.readFileSync("/tmp/node-types.json", "utf8"));
const list = Array.isArray(raw) ? raw : raw.data ?? [];
const names = list.map((entry) => entry.name ?? entry.type);
const ours = names.filter((name) => String(name).toLowerCase().includes("trueconf"));
console.log("total node types:", names.length);
console.log("trueconf node types:", JSON.stringify(ours, null, 2));
const creds = list.filter((entry) => String(entry.name).toLowerCase().includes("trueconf"));
for (const entry of creds) {
	console.log("entry:", entry.name, "version:", JSON.stringify(entry.version), "group:", JSON.stringify(entry.group));
}
'
