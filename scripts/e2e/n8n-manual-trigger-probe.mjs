/**
 * Probe 4: manual execution of the TrueConf Trigger ("Test step" in the editor).
 *
 * In manual mode n8n calls trigger() and then manualTriggerFunction, which waits for the first
 * event. This probe starts such a run over REST, pushes an event and checks that the execution
 * finishes with the event payload.
 *
 * Usage on the n8n host: node n8n-manual-trigger-probe.mjs
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/tmp/tc-e2e/config.json', 'utf8'));
const BASE = 'http://127.0.0.1:5678';
const CONTROL = `http://127.0.0.1:${config.controlPort}`;
let cookie = '';

async function api(path, { method = 'GET', body, base = BASE } = {}) {
	const headers = { 'content-type': 'application/json' };
	if (cookie && base === BASE) {
		headers.cookie = cookie;
	}
	const response = await fetch(`${base}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const setCookies = response.headers.getSetCookie?.() ?? [];
	if (setCookies.length > 0) {
		cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
	}
	const text = await response.text();
	const payload = text ? JSON.parse(text) : undefined;
	if (!response.ok) {
		throw new Error(`${method} ${base}${path} -> ${response.status}: ${text.slice(0, 500)}`);
	}
	return payload?.data ?? payload;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await api('/rest/login', {
	method: 'POST',
	body: { emailOrLdapLoginId: config.email, password: config.password },
});

const credentials = await api('/rest/credentials');
const list = credentials.results ?? credentials;
const credential = list.find((item) => item.name === config.credentialName);

const created = await api('/rest/workflows', {
	method: 'POST',
	body: {
		name: `Manual trigger probe ${Date.now()}`,
		nodes: [
			{
				parameters: {
					events: ['message'],
					chatIds: '',
					ignoreOwnMessages: true,
					includeSystemMessages: false,
					receiveUnread: false,
				},
				id: 'trueconf-trigger',
				name: 'TrueConf Trigger',
				type: 'n8n-nodes-trueconf.trueConfTrigger',
				typeVersion: 1,
				position: [0, 0],
				credentials: { trueConfApi: { id: credential.id, name: credential.name } },
			},
			{ parameters: {}, id: 'noop', name: 'Done', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [240, 0] },
		],
		connections: { 'TrueConf Trigger': { main: [[{ node: 'Done', type: 'main', index: 0 }]] } },
		settings: { executionOrder: 'v1' },
	},
});
const workflow = created.data ?? created;
console.log('workflow', workflow.id);

const before = await api('/__state', { base: CONTROL });
const started = await api(`/rest/workflows/${workflow.id}/run`, {
	method: 'POST',
	body: { triggerToStartFrom: { name: 'TrueConf Trigger' } },
});
console.log('manual run started:', JSON.stringify(started).slice(0, 200));

let connected = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
	const state = await api('/__state', { base: CONTROL });
	if ((state.authorizedClients ?? 0) > (before.authorizedClients ?? 0)) {
		connected = true;
		break;
	}
	await sleep(250);
}
console.log('trigger connected in manual mode:', connected);

await api('/__push', {
	method: 'POST',
	base: CONTROL,
	body: {
		method: 'sendMessage',
		payload: {
			chat: { chatId: 'chat-1', chatTitle: 'Manual probe', chatType: 2 },
			chatId: 'chat-1',
			messageId: 'manual-probe-message',
			timestamp: Date.now(),
			author: { id: 'user@mock.local', type: 1 },
			box: { id: 4, position: '0' },
			type: 200,
			content: { text: 'manual-trigger-e2e', parseMode: 'text' },
			isEdited: false,
		},
	},
});

const executionId = started.executionId;
let execution;
for (let attempt = 0; attempt < 80; attempt += 1) {
	execution = await api(`/rest/executions/${executionId}?includeData=true`);
	if (!['running', 'new', 'waiting'].includes(execution.status)) {
		break;
	}
	await sleep(300);
}
console.log('execution status:', execution.status);

const data = typeof execution.data === 'string' ? JSON.parse(execution.data) : execution.data;
console.log('data is array (flattened):', Array.isArray(data));
console.log('raw data head:', JSON.stringify(data).slice(0, 200));
