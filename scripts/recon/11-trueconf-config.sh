#!/bin/bash
# Read-only: find TrueConf DB credentials and existing users (no writes).
set -u
echo "== config dirs =="
ls -la /etc/trueconf 2>/dev/null | head
ls -la /opt/trueconf/server/conf 2>/dev/null | head -20
echo "== db-related config =="
grep -rIl "dbname\|database\|postgres" /opt/trueconf/server/conf /etc/trueconf 2>/dev/null | head -10
echo "== trueconf-db unit =="
systemctl cat trueconf-db 2>/dev/null | head -30
echo "== postgres access as trueconf db owner =="
for f in /opt/trueconf/server/conf/*.conf /etc/trueconf/*.conf; do
	[ -f "$f" ] && echo "--- $f" && grep -iE "db|user|pass|host|port" "$f" | head -12
done 2>/dev/null
echo "== binaries =="
ls /opt/trueconf/server/bin 2>/dev/null | head -20
