/**
 * Probe: reveals the exact REST payload shapes of n8n 2.47 that the e2e suite depends on
 * (workflow creation response, execution result data, activation input).
 *
 * Usage on the n8n host: node n8n-probe.mjs
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
const credList = credentials.data ?? credentials;
const credential = (credList.results ?? credList).find((item) => item.name === config.credentialName);

const created = await api('/rest/workflows', {
	method: 'POST',
	body: {
		name: `Probe ${Date.now()}`,
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
console.log('POST /rest/workflows -> top-level keys:', Object.keys(created));
console.log('workflow.versionId:', workflow.versionId, '| activeVersionId:', workflow.activeVersionId);

const run = await api(`/rest/workflows/${workflow.id}/run`, {
	method: 'POST',
	body: { triggerToStartFrom: { name: 'When clicking Execute' } },
});
const runData = run.data ?? run;
const executionId = runData.executionId ?? runData.execution?.id;
console.log('execution id:', executionId);

let execution;
for (let attempt = 0; attempt < 60; attempt += 1) {
	execution = await api(`/rest/executions/${executionId}?includeData=true`);
	if (!['running', 'new', 'waiting'].includes(execution.status)) {
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, 300));
}

const exec = execution.data ?? execution;
console.log('execution.status:', exec.status, '| typeof data:', typeof exec.data);
const parsed = typeof exec.data === 'string' ? JSON.parse(exec.data) : exec.data;
console.log('parsed data keys:', parsed ? Object.keys(parsed) : null);
console.log('resultData keys:', parsed?.resultData ? Object.keys(parsed.resultData) : null);

const runDataMap = parsed?.resultData?.runData ?? {};
console.log('runData node names:', Object.keys(runDataMap));
const entry = runDataMap['TrueConf']?.[0];
if (entry) {
	console.log('entry keys:', Object.keys(entry));
	console.log('entry.data keys:', entry.data ? Object.keys(entry.data) : null);
	console.log('entry.data.main:', JSON.stringify(entry.data?.main)?.slice(0, 700));
	console.log('entry.executionStatus:', entry.executionStatus);
}

console.log('activation attempt with versionId...');
try {
	const activated = await api(`/rest/workflows/${workflow.id}/activate`, {
		method: 'POST',
		body: { versionId: workflow.versionId, name: 'Probe activation' },
	});
	const active = activated.data ?? activated;
	console.log('activated keys:', Object.keys(active));
	console.log('active:', active.active, '| activeVersionId:', active.activeVersionId);
} catch (error) {
	console.log('activation failed:', String(error).slice(0, 500));
}
