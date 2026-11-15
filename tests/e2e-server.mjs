/**
 * Standalone mock TrueConf Bridge for end-to-end tests through a real n8n instance.
 *
 * Starts the mock protocol server (default 127.0.0.1:4309, exactly where a local
 * TrueConf Bridge listens) plus a control server on the next port that lets a test
 * driver inspect received requests and push server events:
 *
 *   GET  /__state   -> { tokenRequests, requests, notifications, clients }
 *   POST /__push    -> {"method":"sendMessage","payload":{...}}  push a server event
 *   POST /__reset   -> clear collected state
 *
 * Run: node tests/e2e-server.mjs [--port 4309] [--host 127.0.0.1]
 */
import { createServer } from 'node:http';

import { createMockTrueConf } from './mock-bridge.mjs';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? fallback : args[index + 1];
};

const port = Number(readArg('port', '4309'));
const host = readArg('host', '127.0.0.1');

const bridge = await createMockTrueConf({ port, host });
let pushedEvents = 0;

const json = (res, status, body) => {
	const payload = JSON.stringify(body ?? {});
	res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
	res.end(payload);
};

const control = createServer(async (req, res) => {
	const url = new URL(req.url, `http://${host}`);

	if (req.method === 'GET' && url.pathname === '/__state') {
		const methods = {};
		for (const request of bridge.state.requests) {
			if (request?.method) {
				methods[request.method] = (methods[request.method] ?? 0) + 1;
			}
		}
		json(res, 200, {
			tokenRequests: bridge.state.tokenRequests,
			requestCount: bridge.state.requests.length,
			methodCounts: methods,
			requests: bridge.state.requests,
			fileUploads: bridge.state.fileUploads.map((upload) => ({
				uploadTaskId: upload.uploadTaskId,
				bytes: upload.body.length,
			})),
			notifications: bridge.state.notifications,
			pushedEvents,
			clients: bridge.state.connections.size,
			authorizedClients: [...bridge.state.connections].filter((socket) => socket.authorized).length,
		});
		return;
	}

	if (req.method === 'GET' && url.pathname === '/__file') {
		const content = Buffer.from('TrueConf e2e attachment\n');
		res.writeHead(200, {
			'content-type': 'text/plain',
			'content-disposition': 'attachment; filename="e2e.txt"',
			'content-length': content.length,
		});
		res.end(content);
		return;
	}

	if (req.method === 'POST' && url.pathname === '/__push') {
		const chunks = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
		const method = body.method ?? 'sendMessage';
		const payload = body.payload ?? bridge.envelope();
		try {
			await bridge.pushNotification(method, payload);
			pushedEvents += 1;
			json(res, 200, { ok: true, method });
		} catch (error) {
			json(res, 503, { ok: false, error: String(error) });
		}
		return;
	}

	if (req.method === 'POST' && url.pathname === '/__reset') {
		bridge.state.requests.length = 0;
		bridge.state.notifications.length = 0;
		bridge.state.fileUploads.length = 0;
		bridge.state.tokenRequests = 0;
		pushedEvents = 0;
		json(res, 200, { ok: true });
		return;
	}

	json(res, 404, { error: 'not_found' });
});

await new Promise((resolve) => control.listen(port + 1, host, resolve));

console.log(`[e2e] mock TrueConf Bridge on ws/http ${host}:${port}`);
console.log(`[e2e] control API on http://${host}:${port + 1}`);

const shutdown = async () => {
	await new Promise((resolve) => control.close(resolve));
	await bridge.close();
	process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
