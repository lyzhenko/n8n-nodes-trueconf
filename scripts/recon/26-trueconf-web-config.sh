#!/bin/bash
# Read-only: how is the TrueConf web server configured (listen/ssl/vhosts)?
set -u
echo "== listen.conf =="
cat /opt/trueconf/server/etc/webmanager/listen.conf 2>/dev/null
echo "== httpd.conf (head) =="
sed -n '1,80p' /opt/trueconf/server/etc/webmanager/httpd.conf 2>/dev/null
echo "== ssl / vhost sections =="
grep -n -iE "listen|virtualhost|sslengine|sslcert|documentroot|proxy" /opt/trueconf/server/etc/webmanager/httpd.conf 2>/dev/null | head -40
echo "== conf.d =="
ls -la /opt/trueconf/server/etc/webmanager/conf.d 2>/dev/null
echo "== extra =="
ls -la /opt/trueconf/server/etc/webmanager/extra 2>/dev/null
