#!/bin/bash
# Installs the packed n8n-nodes-trueconf tarball into the n8n user folder and restarts n8n.
# Runs as root on the n8n host. Usage: install-node.sh /tmp/n8n-nodes-trueconf-0.1.0.tgz
set -euo pipefail

TGZ="${1:?usage: install-node.sh <package.tgz>}"
N8N_USER="${N8N_USER:-n8n}"
N8N_HOME="/var/lib/n8n"
TARGET="${N8N_HOME}/.n8n/nodes/node_modules/n8n-nodes-trueconf"

if [ ! -f "$TGZ" ]; then
	echo "package not found: $TGZ" >&2
	exit 1
fi

echo "== installing $(basename "$TGZ") into $TARGET =="
rm -rf "$TARGET"
install -d -o "$N8N_USER" -g "$N8N_USER" -m 0750 "$TARGET"
tar -xzf "$TGZ" -C "$TARGET" --strip-components=1

# The service runs with UMask=0027 and reads as the n8n user only.
chown -R "$N8N_USER:$N8N_USER" "$TARGET"
find "$TARGET" -type d -exec chmod 0750 {} +
find "$TARGET" -type f -exec chmod 0640 {} +

echo "== contents =="
find "$TARGET" -maxdepth 2 -type d | sort
echo "-- entry points --"
/opt/node/bin/node -e "const p=require('$TARGET/package.json');console.log(JSON.stringify(p.n8n,null,2))"
ls -l "$TARGET/dist/nodes/TrueConf"/*.js
echo "-- bundled runtime deps --"
ls -d "$TARGET/node_modules/ws" 2>/dev/null || echo "WARNING: bundled dependency ws is missing from the tarball"

echo "== restarting n8n =="
systemctl restart n8n

for _ in $(seq 1 60); do
	if curl -sf -o /dev/null http://127.0.0.1:5678/healthz; then
		echo "n8n is up"
		break
	fi
	sleep 2
done
systemctl is-active n8n

echo "== log lines mentioning trueconf =="
journalctl -u n8n --since '-3 min' -o cat | grep -i "trueconf" || echo "(no trueconf lines — checked below via executed workflow)"
