#!/bin/bash
# Verifies that n8n serves the TrueConf icon (community node `file:` icon resolution).
set -u
BASE=http://127.0.0.1:5678
COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

curl -s -c "$COOKIE" -X POST "$BASE/rest/login" \
	-H 'content-type: application/json' \
	-d "{\"emailOrLdapLoginId\":\"${N8N_EMAIL:-admin@example.com}\",\"password\":\"${N8N_PASS:?set N8N_PASS}\"}" >/dev/null

curl -s -b "$COOKIE" "$BASE/rest/node-types" > /tmp/nt.json
/opt/node/bin/node -e '
const fs = require("fs");
const raw = JSON.parse(fs.readFileSync("/tmp/nt.json", "utf8"));
const list = Array.isArray(raw) ? raw : raw.data;
for (const entry of list) {
  if (String(entry.name).includes("trueconf")) {
    console.log(entry.name, "| icon:", JSON.stringify(entry.icon), "| iconUrl:", JSON.stringify(entry.iconUrl));
  }
}
'
echo "-- icon HTTP checks --"
for path in \
	"/icons/n8n-nodes-trueconf/dist/nodes/TrueConf/trueconf.png" \
	"/icons/n8n-nodes-trueconf/trueconf.png" \
	"/icons/n8n-nodes-trueconf/nodes/TrueConf/trueconf.png"; do
	code=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -b "$COOKIE" "$BASE$path")
	echo "$path -> $code"
done
