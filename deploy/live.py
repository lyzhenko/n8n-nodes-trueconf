#!/usr/bin/env python3
"""Runs the live end-to-end test of the TrueConf node against the real TrueConf Server.

Takes the bot account from the repository .env (TRUECONF_BOT_USER / TRUECONF_BOT_PASS), the
TrueConf address from TRUECONF_PATH and the n8n SSH access from deploy/.env (or ../n8n_deploy/.env).
Uploads the test script and its config to the n8n host and runs it there, so n8n talks to
TrueConf from its own network position.

Usage:
    python deploy/live.py
    python deploy/live.py --target eladm@example.trueconf.name
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import paramiko
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
REPO_ENV = ROOT / '.env'
DEPLOY_ENV = ROOT / 'deploy' / '.env'
FALLBACK_DEPLOY_ENV = ROOT.parent / 'n8n_deploy' / '.env'
REMOTE_DIR = '/tmp/tc-live'
NOTES = ROOT.parent / 'n8n_deploy' / 'logs' / 'credentials.txt'


def load_repo_env() -> dict[str, str]:
    if not REPO_ENV.exists():
        sys.exit(f'[live] {REPO_ENV} not found')
    raw = dotenv_values(REPO_ENV)
    env = {k: (v or '') for k, v in raw.items() if k}
    for key in ('TRUECONF_PATH', 'TRUECONF_BOT_USER', 'TRUECONF_BOT_PASS'):
        if not env.get(key):
            sys.exit(f'[live] missing {key} in {REPO_ENV}')
    return env


def load_ssh_env() -> dict[str, str]:
    env_file = DEPLOY_ENV if DEPLOY_ENV.exists() else FALLBACK_DEPLOY_ENV
    raw = dotenv_values(env_file)
    env = {k: (v or '') for k, v in raw.items() if k}
    for key in ('SSH_HOST', 'SSH_USER', 'SSH_PASSWORD'):
        if not env.get(key):
            sys.exit(f'[live] missing {key} in {env_file}')
    return env


def admin_credentials() -> tuple[str, str]:
    email, password = 'admin@example.com', ''
    if NOTES.exists():
        for line in NOTES.read_text(encoding='utf-8').splitlines():
            low = line.lower()
            if low.startswith('admin login'):
                email = line.split(':', 1)[1].strip()
            elif low.startswith('admin password'):
                password = line.split(':', 1)[1].strip()
    if not password:
        sys.exit('[live] cannot read the n8n admin password from n8n_deploy/logs/credentials.txt')
    return email, password


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', help='TrueConf ID that receives the test message')
    parser.add_argument('--text', default='n8n live test')
    args = parser.parse_args()

    repo = load_repo_env()
    ssh = load_ssh_env()
    email, password = admin_credentials()

    base = repo['TRUECONF_PATH'].rstrip('/')
    if '://' not in base:
        base = f'http://{base}'
    bridge_url = f'{base}:4309' if base.count(':') == 1 else base
    # TRUECONF_PATH=http://trueconf.example.com -> http://trueconf.example.com:4309
    if base.startswith('http://') or base.startswith('https://'):
        host_part = base.split('://', 1)[1]
        if ':' not in host_part:
            bridge_url = f'{base}:4309'

    config = {
        'email': email,
        'password': password,
        'publicUrl': 'https://n8n.example.com',
        'credentialName': 'TrueConf (live)',
        'bridgeUrl': bridge_url,
        'botUser': repo['TRUECONF_BOT_USER'],
        'botPassword': repo['TRUECONF_BOT_PASS'],
        'targetUser': args.target or repo.get('TRUECONF_TARGET_USER') or repo['TRUECONF_BOT_USER'],
        'text': args.text,
    }

    print(f'[live] bridge: {bridge_url}')
    print(f'[live] bot:    {config["botUser"]}')
    print(f'[live] target: {config["targetUser"]}')

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.load_system_host_keys()
    client.connect(
        hostname=ssh['SSH_HOST'],
        port=int(ssh.get('SSH_PORT') or 22),
        username=ssh['SSH_USER'],
        password=ssh['SSH_PASSWORD'],
        timeout=25,
        banner_timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )

    try:
        sftp = client.open_sftp()
        try:
            sftp.mkdir(REMOTE_DIR)
        except OSError:
            pass
        with sftp.file(f'{REMOTE_DIR}/config.json', 'w') as handle:
            handle.write(json.dumps(config, ensure_ascii=False, indent=2))
        sftp.chmod(f'{REMOTE_DIR}/config.json', 0o600)
        sftp.put(str(ROOT / 'scripts' / 'live' / 'n8n-live.mjs'), f'{REMOTE_DIR}/n8n-live.mjs')
        sftp.close()

        _, stdout, stderr = client.exec_command(
            f'/opt/node/bin/node {REMOTE_DIR}/n8n-live.mjs', timeout=300
        )
        out = stdout.read().decode('utf-8', 'replace')
        err = stderr.read().decode('utf-8', 'replace')
        code = stdout.channel.recv_exit_status()
        print(out)
        if err.strip():
            print(err, file=sys.stderr)
        return code
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
