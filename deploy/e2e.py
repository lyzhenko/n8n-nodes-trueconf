#!/usr/bin/env python3
"""Drives the mock TrueConf Bridge on the n8n host for end-to-end tests.

The mock runs as a transient systemd unit (`tc-e2e.service`) so that it survives the
SSH session and can be inspected with journalctl.

Commands:
    python deploy/e2e.py start                    # upload mock + ws, (re)start on 127.0.0.1:4309
    python deploy/e2e.py state                    # what the mock has received so far
    python deploy/e2e.py push [--text "hello"]    # push a sendMessage event to connected bots
    python deploy/e2e.py push --method command --payload '{...}'
    python deploy/e2e.py reset                    # clear collected state
    python deploy/e2e.py stop
    python deploy/e2e.py logs
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import paramiko
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / 'deploy' / '.env'
FALLBACK_ENV_FILE = ROOT.parent / 'n8n_deploy' / '.env'
REMOTE_DIR = '/tmp/tc-e2e'
UNIT = 'tc-e2e'
BRIDGE_PORT = 4309
CONTROL_PORT = BRIDGE_PORT + 1


def load_env() -> dict[str, str]:
    env_file = ENV_FILE if ENV_FILE.exists() else FALLBACK_ENV_FILE
    raw = dotenv_values(env_file)
    env = {k: (v or '') for k, v in raw.items() if k}
    for key in ('SSH_HOST', 'SSH_USER', 'SSH_PASSWORD'):
        if not env.get(key):
            sys.exit(f'[e2e] missing {key} in {env_file}')
    return env


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


def run(client: paramiko.SSHClient, command: str, timeout: int = 120) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return stdout.channel.recv_exit_status(), out, err


def run_sudo(client: paramiko.SSHClient, command: str, password: str, timeout: int = 120) -> tuple[int, str, str]:
    quoted = "'" + command.replace("'", "'\\''") + "'"
    _, stdout, stderr = client.exec_command(f"sudo -S -p '' bash -c {quoted}", timeout=timeout)
    stdin = stdout.channel.makefile_stdin('wb')
    stdin.write((password + '\n').encode())
    stdin.flush()
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return stdout.channel.recv_exit_status(), out, err


def mkdir_p(sftp: paramiko.SFTPClient, path: str) -> None:
    current = ''
    for part in path.strip('/').split('/'):
        current += '/' + part
        try:
            sftp.mkdir(current)
        except OSError:
            pass


def upload_tree(sftp: paramiko.SFTPClient, local: Path, remote: str) -> None:
    for entry in sorted(local.iterdir()):
        target = f'{remote}/{entry.name}'
        if entry.is_dir():
            mkdir_p(sftp, target)
            upload_tree(sftp, entry, target)
        else:
            sftp.put(str(entry), target)


def deploy_files(sftp: paramiko.SFTPClient) -> None:
    mkdir_p(sftp, REMOTE_DIR)
    sftp.put(str(ROOT / 'tests' / 'mock-bridge.mjs'), f'{REMOTE_DIR}/mock-bridge.mjs')
    sftp.put(str(ROOT / 'tests' / 'e2e-server.mjs'), f'{REMOTE_DIR}/e2e-server.mjs')

    ws_source = ROOT / 'node_modules' / 'ws'
    if not ws_source.exists():
        sys.exit('[e2e] node_modules/ws is missing — run npm install first')
    mkdir_p(sftp, f'{REMOTE_DIR}/node_modules/ws')
    upload_tree(sftp, ws_source, f'{REMOTE_DIR}/node_modules/ws')


def curl_control(client: paramiko.SSHClient, path: str, method: str = 'GET', body: str | None = None) -> str:
    data = f" --data-binary @- <<'EOF'\n{body}\nEOF" if body is not None else ''
    command = (
        f'curl -s -X {method} http://127.0.0.1:{CONTROL_PORT}{path} '
        f"-H 'content-type: application/json'{data}"
    )
    code, out, err = run(client, command)
    if code != 0:
        print(err.strip(), file=sys.stderr)
    return out


def cmd_start(client: paramiko.SSHClient, password: str) -> int:
    sftp = client.open_sftp()
    deploy_files(sftp)
    sftp.close()

    run_sudo(client, f'systemctl stop {UNIT} >/dev/null 2>&1; systemctl reset-failed {UNIT} >/dev/null 2>&1', password)
    code, out, err = run_sudo(
        client,
        f'systemd-run --unit={UNIT} --collect --working-directory={REMOTE_DIR} '
        f'--setenv=NODE_PATH={REMOTE_DIR}/node_modules '
        f'/opt/node/bin/node e2e-server.mjs --port {BRIDGE_PORT}',
        password,
    )
    print(out.strip() or err.strip())
    if code != 0:
        return code

    for _ in range(30):
        time.sleep(1)
        if curl_control(client, '/__state').strip().startswith('{'):
            print(f'[e2e] bridge is up on 127.0.0.1:{BRIDGE_PORT}, control on {CONTROL_PORT}')
            return 0
    print('[e2e] bridge did not start; logs:')
    print(run_sudo(client, f'journalctl -u {UNIT} -o cat | tail -30', password)[1])
    return 1


def cmd_state(client: paramiko.SSHClient) -> int:
    out = curl_control(client, '/__state')
    if not out.strip():
        print('[e2e] no response from control API', file=sys.stderr)
        return 1
    data = json.loads(out)
    print(
        json.dumps(
            {
                'tokenRequests': data.get('tokenRequests'),
                'requestCount': data.get('requestCount'),
                'methodCounts': data.get('methodCounts'),
                'fileUploads': data.get('fileUploads'),
                'pushedEvents': data.get('pushedEvents'),
                'clients': data.get('clients'),
                'authorizedClients': data.get('authorizedClients'),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def cmd_push(client: paramiko.SSHClient, method: str, payload: str | None, text: str | None) -> int:
    body: dict[str, object] = {'method': method}
    if payload:
        body['payload'] = json.loads(payload)
    elif text is not None:
        body['payload'] = {
            'chat': {'chatId': 'chat-1', 'chatTitle': 'E2E chat', 'chatType': 2},
            'chatId': 'chat-1',
            'messageId': 'e2e-message-1',
            'timestamp': 1765000000000,
            'author': {'id': 'user@mock.local', 'type': 1},
            'box': {'id': 2, 'position': '0'},
            'type': 200,
            'content': {'text': text, 'parseMode': 'text'},
            'isEdited': False,
        }
    print(curl_control(client, '/__push', 'POST', json.dumps(body, ensure_ascii=False)).strip())
    return 0


def read_admin_credentials() -> tuple[str, str]:
    """Reads the n8n owner credentials from the deployment notes."""
    notes = ROOT.parent / 'n8n_deploy' / 'logs' / 'credentials.txt'
    email = 'admin@alexqsoft.int'
    password = ''
    if notes.exists():
        for line in notes.read_text(encoding='utf-8').splitlines():
            lowered = line.lower()
            if lowered.startswith('admin login'):
                email = line.split(':', 1)[1].strip()
            elif lowered.startswith('admin password'):
                password = line.split(':', 1)[1].strip()
    if not password:
        sys.exit('[e2e] cannot read the n8n admin password from n8n_deploy/logs/credentials.txt')
    return email, password


def cmd_setup(client: paramiko.SSHClient, message_text: str | None) -> int:
    email, password = read_admin_credentials()
    config = {
        'email': email,
        'password': password,
        'bridgeUrl': f'http://127.0.0.1:{BRIDGE_PORT}',
        'controlPort': CONTROL_PORT,
        'credentialName': 'TrueConf E2E mock',
        'botUsername': 'bot@mock.local',
        'botPassword': 'secret',
        'messageText': message_text or 'Hello from n8n e2e',
        'publicUrl': 'https://192.168.0.11',
    }

    sftp = client.open_sftp()
    mkdir_p(sftp, REMOTE_DIR)
    with sftp.file(f'{REMOTE_DIR}/config.json', 'w') as handle:
        handle.write(json.dumps(config, ensure_ascii=False, indent=2))
    sftp.chmod(f'{REMOTE_DIR}/config.json', 0o600)
    sftp.put(str(ROOT / 'scripts' / 'e2e' / 'n8n-setup.mjs'), f'{REMOTE_DIR}/n8n-setup.mjs')
    sftp.close()

    code, out, err = run(client, f'/opt/node/bin/node {REMOTE_DIR}/n8n-setup.mjs')
    print(out.strip())
    if code != 0:
        print(err.strip(), file=sys.stderr)
    return code


def cmd_execute(client: paramiko.SSHClient, password: str, workflow_id: str) -> int:
    inner = (
        'set -a; . /etc/n8n/n8n.env; set +a; '
        'export N8N_RUNNERS_ENABLED=false; unset N8N_RUNNERS_MODE; '
        'cd /var/lib/n8n; '
        f'HOME=/var/lib/n8n /opt/node/bin/node /opt/n8n/lib/node_modules/n8n/bin/n8n '
        f'execute --id {workflow_id} --rawOutput'
    )
    code, out, err = run_sudo(client, f'sudo -u n8n bash -c {inner!r}', password, timeout=180)
    print(out.strip())
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return code


def cmd_run(client: paramiko.SSHClient, workflow_id: str, node_name: str, trigger_name: str) -> int:
    sftp = client.open_sftp()
    sftp.put(str(ROOT / 'scripts' / 'e2e' / 'n8n-run.mjs'), f'{REMOTE_DIR}/n8n-run.mjs')
    sftp.close()
    code, out, err = run(
        client,
        f"/opt/node/bin/node {REMOTE_DIR}/n8n-run.mjs {workflow_id} '{trigger_name}' '{node_name}'",
        timeout=180,
    )
    print(out.strip())
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return code


def cmd_suite(client: paramiko.SSHClient) -> int:
    sftp = client.open_sftp()
    for script in ('n8n-suite.mjs', 'n8n-setup.mjs', 'n8n-run.mjs'):
        sftp.put(str(ROOT / 'scripts' / 'e2e' / script), f'{REMOTE_DIR}/{script}')
    sftp.close()
    code, out, err = run(client, f'/opt/node/bin/node {REMOTE_DIR}/n8n-suite.mjs', timeout=300)
    print(out.strip())
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return code


def cmd_script(client: paramiko.SSHClient, script_name: str, script_args: str = '') -> int:
    local = ROOT / 'scripts' / 'e2e' / script_name
    if not local.exists():
        sys.exit(f'[e2e] script not found: {local}')
    sftp = client.open_sftp()
    sftp.put(str(local), f'{REMOTE_DIR}/{script_name}')
    sftp.close()
    code, out, err = run(client, f'/opt/node/bin/node {REMOTE_DIR}/{script_name} {script_args}', timeout=300)
    print(out.strip())
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        'command',
        choices=['start', 'state', 'push', 'reset', 'stop', 'logs', 'setup', 'execute', 'run', 'suite', 'script'],
    )
    parser.add_argument('--method', default='sendMessage')
    parser.add_argument('--payload')
    parser.add_argument('--text')
    parser.add_argument('--workflow-id')
    parser.add_argument('--node-name', default='TrueConf')
    parser.add_argument('--trigger-name', default='When clicking Execute')
    parser.add_argument('--script')
    parser.add_argument('--script-args', default='')
    args = parser.parse_args()

    env = load_env()
    client = connect(env)
    try:
        if args.command == 'start':
            return cmd_start(client, env['SSH_PASSWORD'])
        if args.command == 'state':
            return cmd_state(client)
        if args.command == 'push':
            return cmd_push(client, args.method, args.payload, args.text)
        if args.command == 'reset':
            print(curl_control(client, '/__reset', 'POST', '{}').strip())
            return 0
        if args.command == 'stop':
            print(run_sudo(client, f'systemctl stop {UNIT}', env['SSH_PASSWORD'])[1].strip())
            print('[e2e] stopped')
            return 0
        if args.command == 'setup':
            return cmd_setup(client, args.text)
        if args.command == 'suite':
            return cmd_suite(client)
        if args.command == 'script':
            if not args.script:
                sys.exit('[e2e] --script is required for script')
            return cmd_script(client, args.script, args.script_args)
        if args.command == 'run':
            if not args.workflow_id:
                sys.exit('[e2e] --workflow-id is required for run')
            return cmd_run(client, args.workflow_id, args.node_name, args.trigger_name)
        if args.command == 'execute':
            if not args.workflow_id:
                sys.exit('[e2e] --workflow-id is required for execute')
            return cmd_execute(client, env['SSH_PASSWORD'], args.workflow_id)
        print(run_sudo(client, f'journalctl -u {UNIT} -o cat | tail -40', env['SSH_PASSWORD'])[1])
        return 0
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
