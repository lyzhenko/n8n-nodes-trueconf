/**
 * Checks that n8n serves the TrueConf icons (node, trigger, credential) with an authenticated
 * session, and that the bytes are a PNG.
 *
 * Usage on the n8n host: node icon-check.mjs
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('/tmp/tc-live/config.json', 'utf8'));
const BASE = 'http://127.0.0.1:5678';

const login = await fetch(`${BASE}/rest/login`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ emailOrLdapLoginId: config.email, password: config.password }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ');
console.log('login:', login.status);

const paths = [
	'/icons/n8n-nodes-trueconf/dist/nodes/TrueConf/trueconf.png',
	'/icons/n8n-nodes-trueconf/dist/credentials/trueconf.png',
];

for (const path of paths) {
	const response = await fetch(`${BASE}${path}`, { headers: { cookie } });
	const buffer = Buffer.from(await response.arrayBuffer());
	const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	console.log(`${path} -> ${response.status} ${response.headers.get('content-type')} ${buffer.length}b png=${isPng}`);
}
