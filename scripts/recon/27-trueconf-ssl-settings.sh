#!/bin/bash
# Read-only: web/SSL related settings in the TrueConf config store + vhost layout.
set -u
PSQL=/opt/trueconf/server/bin/database/psql
q() { sudo -u postgres "$PSQL" -p 5444 -d tcs -t -A -F'|' -c "$1" 2>&1; }

echo "== config columns =="
q "select column_name from information_schema.columns where table_schema='main' and table_name='configs' order by ordinal_position"
echo "== web/ssl keys =="
q "select * from main.configs" 2>/dev/null | grep -iE "ssl|https|web|port|cert" | head -20

echo "== listen.conf =="
cat /opt/trueconf/server/etc/webmanager/listen.conf
echo "== vhosts =="
cat /opt/trueconf/server/etc/webmanager/extra/httpd-vhosts.conf
echo "== proxy-location =="
cat /opt/trueconf/server/etc/webmanager/extra/proxy-location.conf
