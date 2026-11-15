#!/bin/bash
# Read-only: how does n8n 2.47 expose workflow publishing/activation, and what does an
# execution payload look like? Used to drive the e2e suite over REST.
set -u
CTRL=/opt/n8n/lib/node_modules/n8n/dist/workflows/workflows.controller.js

echo "== POST routes in workflows.controller =="
grep -oE "Post\('[^']+'\)" "$CTRL" | sort -u

echo "== publish-related symbols =="
grep -n "publish" "$CTRL" | head -20

echo "== activate method =="
grep -n -A 18 "async activate(req" "$CTRL" | head -40

echo "== ManualRunDto location =="
grep -rn "versionId" /opt/n8n/lib/node_modules/n8n/node_modules/@n8n/api-types/dist/dto/workflows/activate-workflow.dto.js 2>/dev/null | head -10
ls /opt/n8n/lib/node_modules/n8n/node_modules/@n8n/api-types/dist/dto/workflows/ | head -20
