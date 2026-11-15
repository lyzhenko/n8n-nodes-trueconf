#!/usr/bin/env python3
"""Runs commands on the TrueConf host configured in .env (TRUECONF_PATH/USER/PASS).

Usage:
    python deploy/tc_host.py "systemctl status trueconf"
    python deploy/tc_host.py --sudo "psql -l"
    python deploy/tc_host.py --file scripts/recon/10-trueconf-host.sh
    python deploy/tc_host.py --file script.sh --script-args "--apply"
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import paramiko
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / '.env'


def load_env() -> dict[str, str]:
    if not ENV_FILE.exists():
        sys.exit(f'[tc] {ENV_FILE} not found')
    raw = dotenv_values(ENV_FILE)
    env = {k: (v or '') for k, v in raw.items() if k}
    for key in ('TRUECONF_PATH', 'TRUECONF_USER', 'TRUECONF_PASS'):
        if not env.get(key):
            sys.exit(f'[tc] missing {key} in .env')

    host = env['TRUECONF_PATH'].replace('http://', '').replace('https://', '').rstrip('/')
    return {
        'host': host,
        'user': env['TRUECONF_USER'],
        'password': env['TRUECONF_PASS'],
    }


def quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('command', nargs='?')
    parser.add_argument('--sudo', action='store_true')
    parser.add_argument('--file', type=Path)
    parser.add_argument('--script-args', default='')
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()

    env = load_env()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=env['host'],
        port=22,
        username=env['user'],
        password=env['password'],
        timeout=20,
        banner_timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )

    try:
        if args.file:
            local = args.file if args.file.is_absolute() else ROOT / args.file
            if not local.exists():
                sys.exit(f'[tc] script not found: {local}')
            sftp = client.open_sftp()
            remote = f"/tmp/{local.stem}.{os.getpid()}{local.suffix}"
            sftp.put(str(local), remote)
            sftp.close()
            interp = 'python3' if local.suffix == '.py' else 'bash'
            # Expose the credentials to the script without showing them in the process list.
            command = (
                f'TRUECONF_PASS={quote(env["password"])} TRUECONF_USER={quote(env["user"])} '
                f'{interp} {remote} {args.script_args}'
            ).strip()
        elif args.command:
            command = args.command
        else:
            parser.error('either command or --file is required')

        if args.sudo:
            command = f"sudo -S -p '' bash -c {quote(command)}"

        stdin, stdout, stderr = client.exec_command(command, timeout=args.timeout)
        if args.sudo:
            stdin.write(env['password'] + '\n')
            stdin.flush()
        out = stdout.read().decode('utf-8', 'replace')
        err = stderr.read().decode('utf-8', 'replace')
        code = stdout.channel.recv_exit_status()
        if out.strip():
            print(out)
        if err.strip():
            print(err, file=sys.stderr)
        return code
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
