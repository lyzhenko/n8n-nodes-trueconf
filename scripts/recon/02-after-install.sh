#!/bin/bash
# Diagnostics after installing a community node (read-only).
set -u
echo "== service =="
systemctl is-active n8n
echo "== healthz =="
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5678/healthz
echo "== recent errors/warnings =="
journalctl -u n8n --since '-10 min' -o cat | grep -Ei 'error|warn|trueconf|community|packages' | tail -40
echo "== startup lines =="
journalctl -u n8n --since '-10 min' -o cat | tail -15
echo "== installed package dir =="
ls -la /var/lib/n8n/.n8n/nodes/node_modules/ 2>&1
echo "== nodes ledger =="
cat /var/lib/n8n/.n8n/nodes/package.json 2>&1 | head -30
echo "== mcp endpoint (nginx) =="
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1/mcp-server/http -H 'content-type: application/json' -d '{}'
