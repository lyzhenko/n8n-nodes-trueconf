#!/bin/bash
# Read-only: list REST routes of the workflows controller in compiled form.
set -u
CTRL=/opt/n8n/lib/node_modules/n8n/dist/workflows/workflows.controller.js
echo "== routes =="
grep -oE "decorators_1\.(Get|Post|Patch|Put|Delete)\)\('[^']+'" "$CTRL" | sed "s/decorators_1\.//" | sort -u
echo
echo "== publish service calls =="
grep -rn "publishWorkflow\|createVersion\|publishHistory" /opt/n8n/lib/node_modules/n8n/dist/workflows/workflow.service.js 2>/dev/null | head -15
