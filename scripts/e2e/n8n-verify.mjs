/**
 * Verifies the credential "Test" button path and tidies up workflows left active by probes.
 *
 * Usage on the n8n host: node n8n-verify.mjs
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
		const error = new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
		error.payload = payload;
		throw error;
	}
	return payload?.data ?? payload;
}

await api('/rest/login', {
	method: 'POST',
	body: { emailOrLdapLoginId: config.email, password: config.password },
});

// 1. Credential test, exactly as the "Test" button in the UI does it.
const credentialList = await api('/rest/credentials');
const credentials = (credentialList.results ?? credentialList).find(
	(item) => item.name === config.credentialName,
);
try {
	const result = await api('/rest/credentials/test', {
		method: 'POST',
		body: {
			credentials: {
				id: credentials.id,
				name: credentials.name,
				type: 'trueConfApi',
				data: {
					baseUrl: config.bridgeUrl,
					username: config.botUsername,
					password: config.botPassword,
					ignoreSslIssues: false,
				},
			},
		},
	});
	console.log('credential test ->', JSON.stringify(result).slice(0, 400));
} catch (error) {
	console.log('credential test FAILED ->', String(error.message).slice(0, 500));
	console.log('payload:', JSON.stringify(error.payload).slice(0, 600));
}

// 2. Deactivate workflows left active by probes.
const list = await api('/rest/workflows?limit=100');
const workflows = Array.isArray(list) ? list : (list?.results ?? []);
let deactivated = 0;
for (const workflow of workflows) {
	if (workflow.active && /^(Trigger probe|Probe)/.test(workflow.name)) {
		try {
			await api(`/rest/workflows/${workflow.id}/deactivate`, { method: 'POST', body: {} });
			deactivated += 1;
			console.log('deactivated:', workflow.name, workflow.id);
		} catch (error) {
			console.log('cannot deactivate', workflow.id, String(error.message).slice(0, 200));
		}
	}
}
console.log(`deactivated ${deactivated} probe workflows`);
