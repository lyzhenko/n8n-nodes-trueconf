/**
 * Removes the artefacts of the mock-Bridge test runs from n8n: probe/E2E workflows and the
 * mock credential. LIVE workflows (real TrueConf) are kept as usage examples.
 *
 * Usage on the n8n host: node n8n-cleanup.mjs
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/tmp/tc-e2e/config.json', 'utf8'));
const BASE = 'http://127.0.0.1:5678';
let cookie = '';

async function api(path, { method = 'GET', body } = {}) {
	const headers = { 'content-type': 'application/json' };
	if (cookie) headers.cookie = cookie;
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const setCookies = response.headers.getSetCookie?.() ?? [];
	if (setCookies.length > 0) cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
	const text = await response.text();
	if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : undefined;
}

await api('/rest/login', {
	method: 'POST',
	body: { emailOrLdapLoginId: config.email, password: config.password },
});

const workflowPayload = await api('/rest/workflows?limit=100');
const workflows = (workflowPayload.data ?? workflowPayload).results ?? (workflowPayload.data ?? workflowPayload);
const removable = workflows.filter((workflow) => /^(E2E:|Probe|Probe2|Trigger probe|Manual trigger probe|LIVE:)/.test(workflow.name));

for (const workflow of removable) {
	if (workflow.active) {
		try {
			await api(`/rest/workflows/${workflow.id}/deactivate`, { method: 'POST', body: {} });
		} catch {
			/* already inactive */
		}
	}
	// n8n 2.x requires archiving before a workflow can be deleted.
	try {
		await api(`/rest/workflows/${workflow.id}/archive`, { method: 'POST', body: {} });
	} catch {
		/* already archived */
	}
	await api(`/rest/workflows/${workflow.id}`, { method: 'DELETE' });
	console.log('deleted workflow:', workflow.name, workflow.id);
}

if (config.credentialName) {
	const credentialPayload = await api('/rest/credentials');
	const credentials = (credentialPayload.data ?? credentialPayload).results ?? (credentialPayload.data ?? credentialPayload);
	const mockCredential = credentials.find((item) => item.name === config.credentialName);
	if (mockCredential) {
		try {
			await api(`/rest/credentials/${mockCredential.id}`, { method: 'DELETE' });
			console.log('deleted credential:', mockCredential.name);
		} catch (error) {
			console.log('credential delete failed:', String(error.message).slice(0, 200));
		}
	}
}

console.log(`cleanup done: ${removable.length} workflows removed`);

