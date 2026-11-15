#!/bin/bash
# Read-only recon of the TrueConf Server host.
set -u
echo "== os / host =="
hostname; cat /etc/os-release | head -3
echo "== trueconf services =="
systemctl list-units --type=service --state=running | grep -i trueconf
echo "== trueconf version =="
rpm -qa 2>/dev/null | grep -i trueconf | head -10
ls -la /opt/trueconf 2>/dev/null | head -10
echo "== listening ports =="
ss -lntp 2>/dev/null | grep -E ':(80|443|4307|4309|4310|8080|5432)\b'
echo "== databases =="
sudo -n -u postgres psql -t -c '\l' 2>/dev/null | head -12 || echo "(no passwordless sudo -u postgres)"
echo "== trueconf db tables =="
sudo -n -u postgres psql -d trueconf -t -c "select table_name from information_schema.tables where table_schema='public' order by table_name" 2>/dev/null | head -40 || true
