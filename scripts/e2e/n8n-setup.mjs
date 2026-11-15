/**
 * Prepares the n8n instance for the end-to-end test:
 *  1. logs in through the REST API (cookie auth);
 *  2. creates the TrueConf credential pointing to the local mock Bridge;
 *  3. creates a draft workflow "Manual Trigger -> TrueConf: Send Message";
 *  4. prints the ids as JSON.
 *
 * Runs on the n8n host: node n8n-setup.mjs
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
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		payload = text;
	}
	if (!response.ok) {
		throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 800)}`);
	}
	return payload;
}

const login = await api('/rest/login', {
	method: 'POST',
	body: { emailOrLdapLoginId: config.email, password: config.password },
});
if (typeof login !== 'object' || login === null) {
	throw new Error(`unexpected login response: ${String(login)}`);
}

const credential = await api('/rest/credentials', {
	method: 'POST',
	body: {
		name: config.credentialName ?? 'TrueConf E2E mock',
		type: 'trueConfApi',
		data: {
			baseUrl: config.bridgeUrl,
			username: config.botUsername,
			password: config.botPassword,
			ignoreSslIssues: false,
		},
	},
});

const credData = credential.data ?? credential;

const workflow = await api('/rest/workflows', {
	method: 'POST',
	body: {
		name: 'E2E: TrueConf send message',
		nodes: [
			{
				parameters: {},
				id: 'e2e-manual-trigger',
				name: 'When clicking Execute',
				type: 'n8n-nodes-base.manualTrigger',
				typeVersion: 1,
				position: [0, 0],
			},
			{
				parameters: {
					resource: 'message',
					operation: 'sendMessage',
					chatId: 'chat-1',
					text: config.messageText ?? 'Hello from n8n e2e',
					parseMode: 'text',
				},
				id: 'e2e-trueconf-node',
				name: 'TrueConf',
				type: 'n8n-nodes-trueconf.trueConf',
				typeVersion: 1,
				position: [240, 0],
				credentials: {
					trueConfApi: { id: credData.id, name: credData.name },
				},
			},
		],
		connections: {
			'When clicking Execute': { main: [[{ node: 'TrueConf', type: 'main', index: 0 }]] },
		},
		settings: { executionOrder: 'v1' },
	},
});

const wfData = workflow.data ?? workflow;
process.stdout.write(
	JSON.stringify(
		{
			credentialId: credData.id,
			credentialName: credData.name,
			workflowId: wfData.id,
			workflowName: wfData.name,
			url: `${config.publicUrl ?? 'https://n8n.example.com'}/workflow/${wfData.id}`,
		},
		null,
		2,
	) + '\n',
);
