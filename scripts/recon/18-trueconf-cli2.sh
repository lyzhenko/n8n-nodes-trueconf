#!/bin/bash
# Read-only: TrueConf server unit, binaries and any admin CLI.
set -u
echo "== trueconf.service =="
systemctl cat trueconf 2>/dev/null | head -40
echo "== binaries in PATH =="
ls -la /usr/bin/trueconf* /usr/sbin/trueconf* /opt/trueconf/server/bin/vcs 2>/dev/null
echo "== vcs file type =="
file /opt/trueconf/server/bin/vcs 2>/dev/null
echo "== try vcs --help as service user =="
USER_TC=$(systemctl show trueconf -p User --value)
echo "service user: ${USER_TC:-root}"
timeout 5 sudo -u "${USER_TC:-root}" /opt/trueconf/server/bin/vcs --help 2>&1 | head -25
