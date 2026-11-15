/**
 * End-to-end suite for the TrueConf node, executed against a running n8n instance and the
 * mock TrueConf Bridge on the same host.
 *
 * Every check goes through the real n8n execution engine: workflows are created through the
 * REST API, run with POST /rest/workflows/:id/run, and their node output is inspected.
 *
 * Usage on the n8n host: node n8n-suite.mjs
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/tmp/tc-e2e/config.json', 'utf8'));
const BASE = 'http://127.0.0.1:5678';
const CONTROL = `http://127.0.0.1:${config.controlPort ?? 4310}`;

let cookie = '';
const results = [];

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
	let payload;
	try {
		payload = text ? JSON.parse(text) : undefined;
	} catch {
		payload = text;
	}
	if (!response.ok) {
		throw new Error(`${method} ${base}${path} -> ${response.status}: ${String(text).slice(0, 500)}`);
	}
	return payload?.data ?? payload;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
	await api('/rest/login', {
		method: 'POST',
		body: { emailOrLdapLoginId: config.email, password: config.password },
	});
}

async function findCredential(name) {
	const list = await api('/rest/credentials');
	const items = Array.isArray(list) ? list : (list?.results ?? []);
	return items.find((item) => item.name === name);
}

async function ensureCredential() {
	const existing = await findCredential(config.credentialName);
	if (existing) {
		return existing;
	}
	const created = await api('/rest/credentials', {
		method: 'POST',
		body: {
			name: config.credentialName,
			type: 'trueConfApi',
			data: {
				baseUrl: config.bridgeUrl,
				username: config.botUsername,
				password: config.botPassword,
				ignoreSslIssues: false,
			},
		},
	});
	return created;
}

async function createWorkflow(name, nodes, connections) {
	const created = await api('/rest/workflows', {
		method: 'POST',
		body: {
			name,
			nodes,
			connections,
			settings: { executionOrder: 'v1' },
		},
	});
	return created;
}

async function waitExecution(executionId, timeoutMs = 45_000) {
	const deadline = Date.now() + timeoutMs;
	let execution;
	while (Date.now() < deadline) {
		execution = await api(`/rest/executions/${executionId}?includeData=true`);
		const status = execution.status;
		if (status !== 'running' && status !== 'new' && status !== 'waiting') {
			return execution;
		}
		await sleep(300);
	}
	return execution;
}

/**
 * n8n 2.x stores execution data "flattened": a JSON array whose element 0 is the root and
 * where string values like "5" are references to other elements. This restores the tree.
 */
function unflattenExecutionData(flattened) {
	if (!Array.isArray(flattened)) {
		return flattened;
	}
	const resolved = new Map();
	const resolveValue = (value) => {
		if (typeof value === 'string' && /^\d+$/.test(value) && Number(value) < flattened.length) {
			return resolveIndex(Number(value));
		}
		if (Array.isArray(value)) {
			return value.map(resolveValue);
		}
		if (value !== null && typeof value === 'object') {
			const out = {};
			for (const [key, inner] of Object.entries(value)) {
				out[key] = resolveValue(inner);
			}
			return out;
		}
		return value;
	};
	const resolveIndex = (index) => {
		if (resolved.has(index)) {
			return resolved.get(index);
		}
		const node = flattened[index];
		if (node === null || typeof node !== 'object') {
			return node;
		}
		const placeholder = Array.isArray(node) ? [] : {};
		resolved.set(index, placeholder);
		for (const [key, value] of Object.entries(node)) {
			placeholder[key] = resolveValue(value);
		}
		return placeholder;
	};
	return resolveIndex(0);
}

function executionData(execution) {
	if (!execution?.data) {
		return {};
	}
	if (typeof execution.data === 'string') {
		try {
			return unflattenExecutionData(JSON.parse(execution.data));
		} catch {
			return {};
		}
	}
	return unflattenExecutionData(execution.data);
}

function nodeOutput(execution, nodeName) {
	const runData = executionData(execution)?.resultData?.runData ?? {};
	const runs = runData[nodeName] ?? [];
	const last = runs[runs.length - 1];
	if (!last) {
		return undefined;
	}
	return {
		status: last.executionStatus,
		error: last.error ? { message: last.error.message, description: last.error.description } : undefined,
		items: last.data?.main?.[0]?.map((item) => item.json),
	};
}

async function runWorkflow(workflowId, triggerName, nodeName) {
	const started = await api(`/rest/workflows/${workflowId}/run`, {
		method: 'POST',
		body: { triggerToStartFrom: { name: triggerName } },
	});
	const executionId = started.executionId ?? started.execution?.id;
	if (!executionId) {
		throw new Error(`no execution id in run response: ${JSON.stringify(started)}`);
	}
	const execution = await waitExecution(executionId);
	return { execution, output: nodeOutput(execution, nodeName) };
}

function record(name, ok, details) {
	results.push({ name, ok, details });
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`[${status}] ${name}${ok ? '' : ' -> ' + JSON.stringify(details)}`);
}

function manualTrigger(id = 'trigger') {
	return {
		parameters: {},
		id,
		name: 'When clicking Execute',
		type: 'n8n-nodes-base.manualTrigger',
		typeVersion: 1,
		position: [0, 0],
	};
}

function trueConfNode(parameters, credential, id = 'trueconf') {
	return {
		parameters,
		id,
		name: 'TrueConf',
		type: 'n8n-nodes-trueconf.trueConf',
		typeVersion: 1,
		position: [240, 0],
		credentials: { trueConfApi: { id: credential.id, name: credential.name } },
	};
}

const linear = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });

async function resetMock() {
	await api('/__reset', { method: 'POST', body: {}, base: CONTROL });
}

async function mockState() {
	return await api('/__state', { base: CONTROL });
}

async function pushMessage(text) {
	return await api('/__push', {
		method: 'POST',
		base: CONTROL,
		body: {
			method: 'sendMessage',
			payload: {
				chat: { chatId: 'chat-1', chatTitle: 'E2E chat', chatType: 2 },
				chatId: 'chat-1',
				messageId: 'e2e-message-1',
				timestamp: 1765000000000,
				author: { id: 'user@mock.local', type: 1 },
				box: { id: 2, position: '0' },
				type: 200,
				content: { text, parseMode: 'text' },
				isEdited: false,
			},
		},
	});
}

async function testSendMessage(credential) {
	await resetMock();
	const workflow = await createWorkflow(
		'E2E: send message',
		[manualTrigger(), trueConfNode({ resource: 'message', operation: 'sendMessage', chatId: 'chat-1', text: 'e2e-отправка', parseMode: 'text' }, credential)],
		linear('When clicking Execute', 'TrueConf'),
	);
	const { execution, output } = await runWorkflow(workflow.id, 'When clicking Execute', 'TrueConf');
	const state = await mockState();
	const sent = state.methodCounts?.sendMessage === 1;
	record('sendMessage: workflow succeeded', execution.status === 'success', { status: execution.status, output });
	record('sendMessage: Bridge received sendMessage', sent, state.methodCounts);
	record('sendMessage: messageId returned', Boolean(output?.items?.[0]?.messageId), output);
	return workflow;
}

async function testGetChats(credential) {
	const workflow = await createWorkflow(
		'E2E: get chats',
		[manualTrigger(), trueConfNode({ resource: 'chat', operation: 'getChats', count: 10, page: 1 }, credential)],
		linear('When clicking Execute', 'TrueConf'),
	);
	const { execution, output } = await runWorkflow(workflow.id, 'When clicking Execute', 'TrueConf');
	const items = output?.items ?? [];
	record('getChats: workflow succeeded', execution.status === 'success', { status: execution.status, error: output?.error });
	record('getChats: two chats returned', items.length === 2, items);
}

async function testSendFile(credential) {
	await resetMock();
	const workflow = await createWorkflow(
		'E2E: send file',
		[
			manualTrigger(),
			{
				parameters: {
					url: `http://127.0.0.1:${config.controlPort ?? 4310}/__file`,
					options: { response: { response: { responseFormat: 'file' } } },
				},
				id: 'http-request',
				name: 'Download file',
				type: 'n8n-nodes-base.httpRequest',
				typeVersion: 4.2,
				position: [180, 0],
			},
			trueConfNode(
				{ resource: 'message', operation: 'sendFile', chatId: 'chat-1', binaryPropertyName: 'data', caption: 'e2e file', captionParseMode: 'text' },
				credential,
				'trueconf-file',
			),
		],
		{
			'When clicking Execute': { main: [[{ node: 'Download file', type: 'main', index: 0 }]] },
			'Download file': { main: [[{ node: 'TrueConf', type: 'main', index: 0 }]] },
		},
	);
	const { execution, output } = await runWorkflow(workflow.id, 'When clicking Execute', 'TrueConf');
	const state = await mockState();
	record('sendFile: workflow succeeded', execution.status === 'success', { status: execution.status, error: output?.error });
	record('sendFile: upload reached the Bridge', (state.methodCounts?.uploadFile ?? 0) === 1 && state.fileUploads.length === 1, state);
	record('sendFile: sendFile call made', (state.methodCounts?.sendFile ?? 0) === 1, state.methodCounts);
}

async function testTrigger(credential) {
	await resetMock();
	const workflow = await createWorkflow(
		'E2E: trigger on message',
		[
			{
				parameters: { events: ['message'], chatIds: '', ignoreOwnMessages: true, includeSystemMessages: false, receiveUnread: false },
				id: 'trueconf-trigger',
				name: 'TrueConf Trigger',
				type: 'n8n-nodes-trueconf.trueConfTrigger',
				typeVersion: 1,
				position: [0, 0],
				credentials: { trueConfApi: { id: credential.id, name: credential.name } },
			},
			{
				parameters: {},
				id: 'noop',
				name: 'Done',
				type: 'n8n-nodes-base.noOp',
				typeVersion: 1,
				position: [240, 0],
			},
		],
		{ 'TrueConf Trigger': { main: [[{ node: 'Done', type: 'main', index: 0 }]] } },
	);

	const baseline = await mockState();
	const activated = await api(`/rest/workflows/${workflow.id}/activate`, {
		method: 'POST',
		body: { versionId: workflow.versionId, name: 'E2E trigger activation' },
	});
	const refreshed = await api(`/rest/workflows/${workflow.id}`);
	record('trigger: workflow activated', Boolean(refreshed.active), {
		active: refreshed.active,
		activeVersionId: refreshed.activeVersionId,
		responseActive: activated.active,
	});

	let connected = false;
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const state = await mockState();
		if ((state.authorizedClients ?? 0) > (baseline.authorizedClients ?? 0)) {
			connected = true;
			break;
		}
		await sleep(250);
	}
	record('trigger: bot connected to the Bridge', connected, {
		before: baseline.authorizedClients,
		after: (await mockState()).authorizedClients,
	});

	const before = await api(`/rest/executions?workflowId=${workflow.id}&limit=20`);
	const known = new Set((Array.isArray(before) ? before : (before?.results ?? [])).map((entry) => String(entry.id)));

	await pushMessage('trigger-e2e');

	let fresh;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const list = await api(`/rest/executions?workflowId=${workflow.id}&limit=20`);
		const executions = Array.isArray(list) ? list : (list?.results ?? []);
		fresh = executions.filter((entry) => !known.has(String(entry.id)));
		if (fresh.length > 0 && fresh.some((entry) => entry.status === 'success')) {
			break;
		}
		await sleep(300);
	}

	record('trigger: execution started by the event', (fresh?.length ?? 0) >= 1, (fresh ?? []).map((entry) => entry.status));

	const succeeded = (fresh ?? []).filter((entry) => entry.status === 'success');
	if (succeeded.length > 0) {
		const detail = await waitExecution(succeeded[0].id);
		const triggerOutput = nodeOutput(detail, 'TrueConf Trigger');
		const text = triggerOutput?.items?.[0]?.text;
		record('trigger: event payload delivered', text === 'trigger-e2e', { text, items: triggerOutput?.items });
	}

	await api(`/rest/workflows/${workflow.id}/deactivate`, { method: 'POST', body: {} });
	record('trigger: workflow deactivated', true, {});
}

async function main() {
	await login();
	const credential = await ensureCredential();
	console.log(`credential: ${credential.name} (${credential.id})`);

	await testSendMessage(credential);
	await testGetChats(credential);
	await testSendFile(credential);
	await testTrigger(credential);

	const failed = results.filter((entry) => !entry.ok);
	console.log('');
	console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
	process.exit(failed.length === 0 ? 0 : 1);
}

await main();
