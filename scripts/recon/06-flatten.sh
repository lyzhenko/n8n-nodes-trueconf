#!/bin/bash
# Read-only: is there a public helper to unflatten the 2.x execution data format?
set -u
WF=/opt/n8n/lib/node_modules/n8n/node_modules/n8n-workflow/dist/cjs
CORE=/opt/n8n/lib/node_modules/n8n/node_modules/n8n-core/dist
echo "== n8n-workflow exports mentioning flatten =="
grep -o "exports\.[A-Za-z]*[Ff]latten[A-Za-z]*" "$WF/index.js" | sort -u | head
echo "== n8n-core =="
grep -rlo "[Ff]lattenExecutionData" "$CORE" 2>/dev/null | head -5
echo "== definition =="
grep -rn "function unflattenExecutionData" "$CORE" "$WF" 2>/dev/null | head -3
echo "== index export =="
grep -rn "unflattenExecutionData" "$WF/index.js" | head -3
