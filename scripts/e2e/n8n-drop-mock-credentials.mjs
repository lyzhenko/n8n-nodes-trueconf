/**
 * Deletes leftover mock credentials created by the e2e runs.
 * Usage on the n8n host: node n8n-drop-mock-credentials.mjs
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

const payload = await api('/rest/credentials');
const credentials = (payload.data ?? payload).results ?? (payload.data ?? payload);
const leftovers = credentials.filter((item) => item.name === config.credentialName);
for (const credential of leftovers) {
	await api(`/rest/credentials/${credential.id}`, { method: 'DELETE' });
	console.log('deleted credential:', credential.name, credential.id);
}
console.log(`leftover mock credentials removed: ${leftovers.length}`);
