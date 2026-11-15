#!/bin/bash
# Read-only: why does TrueConf reject the password? Look at server logs and install artifacts.
set -u
echo "== vcs log dir =="
ls -la /opt/trueconf/server/var/log/vcs 2>/dev/null | head
echo "== recent auth-related log lines =="
LOG=$(ls -t /opt/trueconf/server/var/log/vcs/*.log 2>/dev/null | head -1)
echo "log: ${LOG:-none}"
[ -n "${LOG:-}" ] && grep -iE "auth|password|login|invalid" "$LOG" | tail -25

echo "== installation logs =="
ls -la /var/log/trueconf* /root/trueconf* /tmp/trueconf* 2>/dev/null | head -20
grep -rhil "trueconf" /var/log 2>/dev/null | head -10

echo "== files mentioning admin password (names only) =="
grep -rIl "trueconf" /root 2>/dev/null | head -10
ls -la /root | head -20

echo "== auth schema tables =="
PSQL=/opt/trueconf/server/bin/database/psql
sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -c \
  "select table_schema||'.'||table_name from information_schema.tables where table_schema in ('auth') order by 1" 2>&1 | head -20
