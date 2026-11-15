/**
 * Probe 3: does activating a workflow with the TrueConf Trigger really start the trigger?
 *
 * Creates a fresh workflow, activates it with the version id returned by creation, then
 * checks: workflow.active flag, how many WebSocket clients the mock sees, whether a pushed
 * event produces an execution. Leaves the workflow active for inspection.
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
		name: `Trigger probe ${Date.now()}`,
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
console.log('created workflow', workflow.id, 'versionId', workflow.versionId, 'active', workflow.active);

const before = await api('/__state', { base: CONTROL });
console.log('mock before activation: clients', before.clients, 'authorized', before.authorizedClients);

const activateResponse = await api(`/rest/workflows/${workflow.id}/activate`, {
	method: 'POST',
	body: { versionId: workflow.versionId, name: 'trigger probe activation' },
});
console.log('activate response active:', activateResponse.active, '| activeVersionId:', activateResponse.activeVersionId);

await sleep(4000);

const after = await api('/__state', { base: CONTROL });
console.log('mock after activation: clients', after.clients, 'authorized', after.authorizedClients);

const fetched = await api(`/rest/workflows/${workflow.id}`);
console.log('workflow.active via GET:', fetched.active, '| activeVersionId:', fetched.activeVersionId);

const known = new Set();
const listBefore = await api(`/rest/executions?workflowId=${workflow.id}&limit=20`);
for (const entry of Array.isArray(listBefore) ? listBefore : (listBefore?.results ?? [])) {
	known.add(String(entry.id));
}

await api('/__push', {
	method: 'POST',
	base: CONTROL,
	body: {
		method: 'sendMessage',
		payload: {
			chat: { chatId: 'chat-1', chatTitle: 'Probe chat', chatType: 2 },
			chatId: 'chat-1',
			messageId: 'probe-message',
			timestamp: Date.now(),
			author: { id: 'user@mock.local', type: 1 },
			box: { id: 3, position: '0' },
			type: 200,
			content: { text: 'probe-trigger', parseMode: 'text' },
			isEdited: false,
		},
	},
});

await sleep(3000);
const listAfter = await api(`/rest/executions?workflowId=${workflow.id}&limit=20`);
const executions = Array.isArray(listAfter) ? listAfter : (listAfter?.results ?? []);
const fresh = executions.filter((entry) => !known.has(String(entry.id)));
console.log('executions after push:', executions.length, 'new:', fresh.length, fresh.map((entry) => entry.status));
console.log('workflow id for further inspection:', workflow.id);
