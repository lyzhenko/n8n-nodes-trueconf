#!/bin/bash
# Read-only recon on the n8n host (n8n.example.com).
set -u
N8N_ROOT=/opt/n8n/lib/node_modules/n8n
echo "== n8n package =="
node -e "const p=require('$N8N_ROOT/package.json');console.log('n8n',p.version);console.log('engines',JSON.stringify(p.engines));console.log('n8n-workflow dep',p.dependencies['n8n-workflow'])"
echo "== bundled n8n-workflow =="
node -e "console.log(require('$N8N_ROOT/node_modules/n8n-workflow/package.json').version)"
echo "== n8n-core =="
node -e "console.log(require('$N8N_ROOT/node_modules/n8n-core/package.json').version)"
echo "== data dir =="
ls -la /var/lib/n8n/.n8n/ 2>&1 | head -20
echo "== custom nodes dir =="
ls -la /var/lib/n8n/.n8n/nodes 2>&1 | head -20
echo "== N8N env (selected) =="
grep -E 'N8N_(CUSTOM_EXTENSIONS|USER_FOLDER|UNVERIFIED|COMMUNITY|NODES|RUNNERS|ENABLE_COMMUNITY)' /etc/n8n/n8n.env 2>&1
echo "== service user =="
systemctl show n8n -p User -p Group -p StateDirectory 2>&1
echo "== node/npm =="
/opt/node/bin/node --version; /opt/node/bin/npm --version
echo "== disk =="
df -h / | tail -1
echo "== ports (listen) =="
ss -lntp 2>/dev/null | head -20
