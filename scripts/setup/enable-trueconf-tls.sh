#!/bin/bash
# Enables HTTPS (self-signed) on the TrueConf web server.
#
# TrueConf ships an SSL vhost (`<VirtualHost *:${ssl_port}>` in extra/httpd-vhosts.conf) and the
# ssl_module, but listens on port 80 only. This adds a 443 listener and a certificate, which is
# required by TrueConf Server API v4 (it rejects OAuth2 over plain HTTP with "insecureConnection").
#
# Idempotent and reversible: the previous listen.conf is backed up; `--rollback` restores it.
set -euo pipefail

WEB=/opt/trueconf/server/etc/webmanager
CERT_DIR="$WEB/ssl"
SSL_CONF="$WEB/conf.d/10-tls.ssl"
BACKUP_DIR=/root/tc-web-backup

rollback() {
	echo "[tls] rolling back"
	if [ -f "$BACKUP_DIR/listen.conf" ]; then
		cp -a "$BACKUP_DIR/listen.conf" "$WEB/listen.conf"
	fi
	rm -f "$SSL_CONF"
	systemctl restart trueconf-web
	sleep 2
	systemctl is-active trueconf-web
}

if [ "${1:-}" = "--rollback" ]; then
	rollback
	exit 0
fi

if [ ! -d "$BACKUP_DIR" ]; then
	mkdir -p "$BACKUP_DIR"
	cp -a "$WEB/listen.conf" "$BACKUP_DIR/listen.conf"
	echo "[tls] backed up listen.conf to $BACKUP_DIR"
fi

mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/tc.crt" ]; then
	openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
		-keyout "$CERT_DIR/tc.key" -out "$CERT_DIR/tc.crt" \
		-subj "/CN=trueconf-server.example.com" \
		-addext "subjectAltName=DNS:trueconf-server.example.com,DNS:trueconf-server,IP:trueconf.example.com" \
		>/dev/null 2>&1
	echo "[tls] generated self-signed certificate"
fi
chown root:trueconf "$CERT_DIR/tc.key" "$CERT_DIR/tc.crt"
chmod 640 "$CERT_DIR/tc.key"
chmod 644 "$CERT_DIR/tc.crt"

cat > "$SSL_CONF" <<'EOF'
SSLEngine on
SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
SSLCipherSuite HIGH:!aNULL:!MD5:!RC4
SSLCertificateFile "/opt/trueconf/server/etc/webmanager/ssl/tc.crt"
SSLCertificateKeyFile "/opt/trueconf/server/etc/webmanager/ssl/tc.key"
EOF

if ! grep -qE '^Listen (443|\$\{ssl_port\})' "$WEB/listen.conf"; then
	# listen.conf has no trailing newline, so append one before adding the directive.
	[ -n "$(tail -c1 "$WEB/listen.conf")" ] && echo >> "$WEB/listen.conf"
	echo 'Listen 443' >> "$WEB/listen.conf"
	echo "[tls] added Listen 443"
fi

echo "[tls] config test:"
if ! (cd /opt/trueconf/server && ./bin/webmanager/apachectl configtest) 2>&1; then
	echo "[tls] config test FAILED"
	rollback
	exit 1
fi

systemctl restart trueconf-web
sleep 2
echo "[tls] service: $(systemctl is-active trueconf-web)"
curl -sk -o /dev/null -w '[tls] https /admin/ -> %{http_code}\n' https://127.0.0.1/admin/ || true
curl -s -o /dev/null -w '[tls] http  /admin/ -> %{http_code}\n' http://127.0.0.1/admin/ || true
