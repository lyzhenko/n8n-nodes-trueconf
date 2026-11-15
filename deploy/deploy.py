#!/usr/bin/env python3
"""Deploy the packed n8n community node to the n8n host.

Copies the tarball produced by `npm pack` to the server, installs it into the n8n user
folder (`/var/lib/n8n/.n8n/nodes/node_modules/n8n-nodes-trueconf`) and restarts n8n.

Usage (from the repository root):
    python deploy/deploy.py            # build, pack, upload, install, restart
    python deploy/deploy.py --no-build # reuse the existing build output
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import paramiko
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / 'deploy' / '.env'
FALLBACK_ENV_FILE = ROOT.parent / 'n8n_deploy' / '.env'
REMOTE_TGZ = '/tmp/n8n-nodes-trueconf.tgz'


def load_env() -> dict[str, str]:
    env_file = ENV_FILE if ENV_FILE.exists() else FALLBACK_ENV_FILE
    if not env_file.exists():
        sys.exit(f'[deploy] no env file: {ENV_FILE} or {FALLBACK_ENV_FILE}')
    raw = dotenv_values(env_file)
    env = {k: (v or '') for k, v in raw.items() if k}
    for key in ('SSH_HOST', 'SSH_USER', 'SSH_PASSWORD'):
        if not env.get(key):
            sys.exit(f'[deploy] missing {key} in {env_file}')
    return env


def run_local(command: list[str], cwd: Path) -> None:
    print(f'[deploy] $ {" ".join(command)}')
    subprocess.run(command, cwd=cwd, check=True)


def build_and_pack(no_build: bool) -> Path:
    if not no_build:
        run_local(['npm', 'run', 'build'], ROOT)
        run_local(['npm', 'pack', '--silent'], ROOT)
    existing = sorted(ROOT.glob('n8n-nodes-trueconf-*.tgz'), key=lambda p: p.stat().st_mtime)
    if not existing:
        run_local(['npm', 'pack', '--silent'], ROOT)
        existing = sorted(ROOT.glob('n8n-nodes-trueconf-*.tgz'), key=lambda p: p.stat().st_mtime)
    if not existing:
        sys.exit('[deploy] npm pack produced no tarball')
    tgz = existing[-1]
    print(f'[deploy] package: {tgz.name} ({tgz.stat().st_size / 1024:.0f} KiB)')
    return tgz


def connect(env: dict[str, str]) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.load_system_host_keys()
    client.connect(
        hostname=env['SSH_HOST'],
        port=int(env.get('SSH_PORT') or 22),
        username=env['SSH_USER'],
        password=env['SSH_PASSWORD'],
        timeout=25,
        banner_timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    return client


def quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def run_remote(client: paramiko.SSHClient, command: str, password: str, timeout: int = 600) -> int:
    stdin, stdout, stderr = client.exec_command(
        f"sudo -S -p '' bash -c {quote(command)}", timeout=timeout
    )
    stdin.write(password + '\n')
    stdin.flush()

    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out)
    if err.strip():
        print(err, file=sys.stderr)
    return code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-build', action='store_true', help='skip npm build and pack')
    args = parser.parse_args()

    env = load_env()
    tgz = build_and_pack(args.no_build)

    print(f'[deploy] connecting to {env["SSH_USER"]}@{env["SSH_HOST"]}')
    client = connect(env)
    try:
        sftp = client.open_sftp()
        sftp.put(str(tgz), REMOTE_TGZ)
        sftp.chmod(REMOTE_TGZ, 0o644)
        remote_script = '/tmp/install-node.sh'
        sftp.put(str(ROOT / 'deploy' / 'install-node.sh'), remote_script)
        sftp.chmod(remote_script, 0o755)
        sftp.close()

        code = run_remote(client, f'bash {remote_script} {REMOTE_TGZ}', env['SSH_PASSWORD'])
        print(f'[deploy] remote exit code: {code}')
        return code
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
