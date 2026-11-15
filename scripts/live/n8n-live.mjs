/**
 * Live end-to-end test against a real TrueConf Server.
 *
 * Runs on the n8n host. Uses the credential created in n8n (real TrueConf, not the mock) and
 * verifies message delivery by reading the chat history back through the same bot.
 *
 * Config file: /tmp/tc-live/config.json
 *   { email, password, publicUrl, credentialName, bridgeUrl, botUser, targetUser, text }
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/tmp/tc-live/config.json', 'utf8'));
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
	let payload;
	try {
		payload = text ? JSON.parse(text) : undefined;
	} catch {
		payload = text;
	}
	if (!response.ok) {
		throw new Error(`${method} ${path} -> ${response.status}: ${String(text).slice(0, 500)}`);
	}
	return payload?.data ?? payload;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const record = (name, ok, details) => {
	results.push({ name, ok, details });
	console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' -> ' + JSON.stringify(details)}`);
};

function unflatten(flattened) {
	if (!Array.isArray(flattened)) return flattened;
	const cache = new Map();
	const value = (input) => {
		if (typeof input === 'string' && /^\d+$/.test(input) && Number(input) < flattened.length) {
			return at(Number(input));
		}
		if (Array.isArray(input)) return input.map(value);
		if (input && typeof input === 'object') {
			const out = {};
			for (const [key, inner] of Object.entries(input)) out[key] = value(inner);
			return out;
		}
		return input;
	};
	const at = (index) => {
		if (cache.has(index)) return cache.get(index);
		const node = flattened[index];
		if (!node || typeof node !== 'object') return node;
		const placeholder = Array.isArray(node) ? [] : {};
		cache.set(index, placeholder);
		for (const [key, inner] of Object.entries(node)) placeholder[key] = value(inner);
		return placeholder;
	};
	return at(0);
}

function nodeOutput(execution, nodeName) {
	const data = typeof execution?.data === 'string' ? JSON.parse(execution.data) : execution?.data;
	const runData = unflatten(data)?.resultData?.runData ?? {};
	const runs = runData[nodeName] ?? [];
	const last = runs[runs.length - 1];
	return last ? { status: last.executionStatus, error: last.error?.message, items: last.data?.main?.[0]?.map((item) => item.json) } : undefined;
}

async function runWorkflow(workflowId, nodeName) {
	const started = await api(`/rest/workflows/${workflowId}/run`, {
		method: 'POST',
		body: { triggerToStartFrom: { name: 'When clicking Execute' } },
	});
	let execution;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		execution = await api(`/rest/executions/${started.executionId}?includeData=true`);
		if (!['running', 'new', 'waiting'].includes(execution.status)) break;
		await sleep(300);
	}
	return { execution, output: nodeOutput(execution, nodeName) };
}

async function ensureCredential() {
	const list = await api('/rest/credentials');
	const items = list.results ?? list;
	const existing = items.find((item) => item.name === config.credentialName);
	if (existing) {
		await api(`/rest/credentials/${existing.id}`, {
			method: 'PATCH',
			body: {
				name: config.credentialName,
				type: 'trueConfApi',
				data: {
					baseUrl: config.bridgeUrl,
					username: config.botUser,
					password: config.botPassword,
					ignoreSslIssues: config.bridgeUrl.startsWith('https'),
				},
			},
		});
		return existing;
	}
	return await api('/rest/credentials', {
		method: 'POST',
		body: {
			name: config.credentialName,
			type: 'trueConfApi',
			data: {
				baseUrl: config.bridgeUrl,
				username: config.botUser,
				password: config.botPassword,
				ignoreSslIssues: config.bridgeUrl.startsWith('https'),
			},
		},
	});
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

const manualTrigger = () => ({
	parameters: {},
	id: 'trigger',
	name: 'When clicking Execute',
	type: 'n8n-nodes-base.manualTrigger',
	typeVersion: 1,
	position: [0, 0],
});

const linear = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });

async function createWorkflow(name, nodes, connections) {
	return await api('/rest/workflows', {
		method: 'POST',
		body: { name, nodes, connections, settings: { executionOrder: 'v1' } },
	});
}

async function main() {
	await api('/rest/login', {
		method: 'POST',
		body: { emailOrLdapLoginId: config.email, password: config.password },
	});

	// 1. Raw protocol check, independent of n8n.
	const tokenResponse = await fetch(`${config.bridgeUrl}/bridge/api/client/v1/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			client_id: 'chat_bot',
			grant_type: 'password',
			username: config.botUser,
			password: config.botPassword,
		}),
	});
	const tokenText = await tokenResponse.text();
	record('TrueConf: bot token endpoint', tokenResponse.status === 201, {
		status: tokenResponse.status,
		body: tokenText.slice(0, 200),
	});

	const credential = await ensureCredential();
	console.log(`credential: ${credential.name} (${credential.id})`);

	// 2. Credential test through n8n (same path as the "Test" button).
	try {
		const testResult = await api('/rest/credentials/test', {
			method: 'POST',
			body: {
				credentials: {
					id: credential.id,
					name: credential.name,
					type: 'trueConfApi',
					data: {
						baseUrl: config.bridgeUrl,
						username: config.botUser,
						password: config.botPassword,
						ignoreSslIssues: config.bridgeUrl.startsWith('https'),
					},
				},
			},
		});
		record('n8n credential test', testResult.status === 'OK', testResult);
	} catch (error) {
		record('n8n credential test', false, String(error.message).slice(0, 300));
	}

	// 3. Send a message to a real user and remember the chat id.
	const text = `${config.text} ${new Date().toISOString()}`;
	const sendWorkflow = await createWorkflow(
		'LIVE: send message',
		[
			manualTrigger(),
			trueConfNode({ resource: 'message', operation: 'sendMessage', chatId: config.targetUser, text, parseMode: 'text' }, credential),
		],
		linear('When clicking Execute', 'TrueConf'),
	);
	const sent = await runWorkflow(sendWorkflow.id, 'TrueConf');
	record('sendMessage: execution succeeded', sent.execution.status === 'success', {
		status: sent.execution.status,
		output: sent.output,
	});
	const chatId = sent.output?.items?.[0]?.chatId;
	record('sendMessage: messageId returned', Boolean(sent.output?.items?.[0]?.messageId), sent.output);

	// 4. Read the history back and look for the text.
	if (chatId) {
		const historyWorkflow = await createWorkflow(
			'LIVE: chat history',
			[
				manualTrigger(),
				trueConfNode({ resource: 'message', operation: 'getHistory', chatId, count: 10 }, credential),
			],
			linear('When clicking Execute', 'TrueConf'),
		);
		const history = await runWorkflow(historyWorkflow.id, 'TrueConf');
		const texts = (history.output?.items ?? []).map((item) => item.text);
		record('getHistory: sent message is in the chat', texts.includes(text), { texts });
	} else {
		record('getHistory: sent message is in the chat', false, { reason: 'no chatId from sendMessage' });
	}

	// 5. File upload against the real server: a Code node produces binary data, the node sends it.
	const fileName = `live-${Date.now()}.txt`;
	const sendFileWorkflow = await createWorkflow(
		'LIVE: send file',
		[
			manualTrigger(),
			{
				parameters: {
					mode: 'runOnceForAllItems',
					language: 'javaScript',
					jsCode: [
						`const data = Buffer.from('TrueConf live file test ' + new Date().toISOString());`,
						`const binary = await this.helpers.prepareBinaryData(data, ${JSON.stringify(fileName)}, 'text/plain');`,
						`return [{ json: { fileName: ${JSON.stringify(fileName)} }, binary: { data: binary } }];`,
					].join('\n'),
				},
				id: 'code-binary',
				name: 'Make file',
				type: 'n8n-nodes-base.code',
				typeVersion: 2,
				position: [180, 0],
			},
			trueConfNode(
				{
					resource: 'message',
					operation: 'sendFile',
					chatId: config.targetUser,
					binaryPropertyName: 'data',
					caption: 'live file',
					captionParseMode: 'text',
				},
				credential,
				'trueconf-file',
			),
		],
		{
			'When clicking Execute': { main: [[{ node: 'Make file', type: 'main', index: 0 }]] },
			'Make file': { main: [[{ node: 'TrueConf', type: 'main', index: 0 }]] },
		},
	);
	const fileResult = await runWorkflow(sendFileWorkflow.id, 'TrueConf');
	record('sendFile: real upload accepted', fileResult.execution.status === 'success' && Boolean(fileResult.output?.items?.[0]?.fileId), {
		status: fileResult.execution.status,
		error: fileResult.output?.error,
		items: fileResult.output?.items,
	});

	// 6. Trigger against the real server: activate a trigger workflow that does not ignore the
	//    bot's own messages, then send another message and wait for the event to start a run.
	const triggerWorkflow = await createWorkflow(
		'LIVE: trigger on message',
		[
			{
				parameters: {
					events: ['message'],
					chatIds: '',
					ignoreOwnMessages: false,
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
		{ 'TrueConf Trigger': { main: [[{ node: 'Done', type: 'main', index: 0 }]] } },
	);
	const activated = await api(`/rest/workflows/${triggerWorkflow.id}/activate`, {
		method: 'POST',
		body: { versionId: triggerWorkflow.versionId, name: 'LIVE trigger' },
	});
	record('trigger: workflow activated', Boolean(activated.active), { active: activated.active });

	const known = new Set();
	const beforeList = await api(`/rest/executions?workflowId=${triggerWorkflow.id}&limit=20`);
	for (const entry of beforeList.results ?? beforeList) {
		known.add(String(entry.id));
	}

	const triggerText = `${config.text} trigger ${Date.now()}`;
	const secondSend = await createWorkflow(
		'LIVE: send message (trigger source)',
		[
			manualTrigger(),
			trueConfNode({ resource: 'message', operation: 'sendMessage', chatId: config.targetUser, text: triggerText, parseMode: 'text' }, credential),
		],
		linear('When clicking Execute', 'TrueConf'),
	);
	await runWorkflow(secondSend.id, 'TrueConf');

	let fresh = [];
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const list = await api(`/rest/executions?workflowId=${triggerWorkflow.id}&limit=20`);
		fresh = (list.results ?? list).filter((entry) => !known.has(String(entry.id)));
		if (fresh.some((entry) => entry.status === 'success')) break;
		await sleep(500);
	}
	record('trigger: execution started by a real message', fresh.length > 0, fresh.map((entry) => entry.status));

	const succeeded = fresh.filter((entry) => entry.status === 'success');
	if (succeeded.length > 0) {
		const detail = await api(`/rest/executions/${succeeded[0].id}?includeData=true`);
		const output = nodeOutput(detail, 'TrueConf Trigger');
		const parsed = typeof detail.data === 'string' ? JSON.parse(detail.data) : detail.data;
		const unflattened = unflatten(parsed);
		const runData = unflattened?.resultData?.runData ?? {};
		record('trigger: real event payload delivered', output?.items?.[0]?.text === triggerText, {
			text: output?.items?.[0]?.text,
			nodes: Object.keys(runData),
			triggerData: JSON.stringify(runData['TrueConf Trigger']?.[0]?.data ?? null).slice(0, 400),
		});
	}

	await api(`/rest/workflows/${triggerWorkflow.id}/deactivate`, { method: 'POST', body: {} });
	record('trigger: workflow deactivated', true, {});

	const failed = results.filter((entry) => !entry.ok).length;
	console.log('');
	console.log(JSON.stringify({ total: results.length, failed, chatId, results }, null, 2));
	process.exit(failed === 0 ? 0 : 1);
}

await main();
