/**
 * Probe 2: what exactly does GET /rest/executions/:id?includeData=true return in 2.47?
 * Runs a tiny workflow (getChats) and dumps the raw execution JSON around runData.
 *
 * Usage on the n8n host: node n8n-probe2.mjs
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/tmp/tc-e2e/config.json', 'utf8'));
const BASE = 'http://127.0.0.1:5678';
let cookie = '';

async function api(path, { method = 'GET', body } = {}) {
	const headers = { 'content-type': 'application/json' };
	if (cookie) {
		headers.cookie = cookie;
	}
	const response = await fetch(`${BASE}${path}`, {
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
		throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 600)}`);
	}
	return payload;
}

await api('/rest/login', {
	method: 'POST',
	body: { emailOrLdapLoginId: config.email, password: config.password },
});

const credentials = await api('/rest/credentials');
const list = (credentials.data ?? credentials).results ?? (credentials.data ?? credentials);
const credential = list.find((item) => item.name === config.credentialName);

const created = await api('/rest/workflows', {
	method: 'POST',
	body: {
		name: `Probe2 ${Date.now()}`,
		nodes: [
			{
				parameters: {},
				id: 'trigger',
				name: 'When clicking Execute',
				type: 'n8n-nodes-base.manualTrigger',
				typeVersion: 1,
				position: [0, 0],
			},
			{
				parameters: { resource: 'chat', operation: 'getChats', count: 5, page: 1 },
				id: 'tc',
				name: 'TrueConf',
				type: 'n8n-nodes-trueconf.trueConf',
				typeVersion: 1,
				position: [240, 0],
				credentials: { trueConfApi: { id: credential.id, name: credential.name } },
			},
		],
		connections: { 'When clicking Execute': { main: [[{ node: 'TrueConf', type: 'main', index: 0 }]] } },
		settings: { executionOrder: 'v1' },
	},
});
const workflow = created.data ?? created;

const run = await api(`/rest/workflows/${workflow.id}/run`, {
	method: 'POST',
	body: { triggerToStartFrom: { name: 'When clicking Execute' } },
});
const executionId = (run.data ?? run).executionId;
console.log('execution id:', executionId);

await new Promise((resolve) => setTimeout(resolve, 4000));

const raw = await api(`/rest/executions/${executionId}?includeData=true`);
const execution = raw.data ?? raw;
console.log('top keys:', Object.keys(raw));
console.log('status:', execution.status, '| finished:', execution.finished);
console.log('typeof data:', typeof execution.data, '| len:', typeof execution.data === 'string' ? execution.data.length : 'n/a');
if (typeof execution.data === 'string') {
	console.log('data head:', execution.data.slice(0, 240));
}

const parsed = typeof execution.data === 'string' ? JSON.parse(execution.data) : execution.data;
if (!parsed) {
	console.log('NO DATA FIELD');
	const slim = await api(`/rest/executions/${executionId}`);
	console.log('slim keys:', Object.keys(slim.data ?? slim));
	process.exit(0);
}

console.log('parsed top keys:', Object.keys(parsed));
console.log('resultData keys:', Object.keys(parsed.resultData ?? {}));
const runData = parsed.resultData?.runData ?? {};
console.log('runData nodes:', Object.keys(runData));
for (const [name, runs] of Object.entries(runData)) {
	console.log(`--- ${name}: ${runs.length} runs`);
	const entry = runs[runs.length - 1];
	console.log('entry keys:', Object.keys(entry));
	console.log('entry.data:', JSON.stringify(entry.data)?.slice(0, 800));
	console.log('entry.error:', JSON.stringify(entry.error)?.slice(0, 300));
}
