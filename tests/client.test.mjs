import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
	BridgeClient,
	TrueConfError,
	clearTokenCache,
	closeAllBridgeClients,
	fetchBotToken,
	getBridgeClient,
	parseServerUrl,
} from '../dist/nodes/TrueConf/BridgeClient.js';
import { buildMultipartBody, uploadTemporalFile } from '../dist/nodes/TrueConf/GenericFunctions.js';
import { createMockTrueConf } from './mock-bridge.mjs';
import { makeHttpRequest, waitFor } from './helpers.mjs';

const servers = [];

async function startServer(options) {
	const server = await createMockTrueConf(options);
	servers.push(server);
	return server;
}

function credentialsFor(server, overrides = {}) {
	return {
		baseUrl: server.url,
		username: 'bot@mock.local',
		password: 'secret',
		...overrides,
	};
}

after(async () => {
	await closeAllBridgeClients();
	for (const server of servers) {
		await server.close();
	}
});

describe('parseServerUrl', () => {
	it('adds the default scheme and keeps the port', () => {
		assert.deepEqual(parseServerUrl('192.168.0.11:4309'), {
			origin: 'http://192.168.0.11:4309',
			secure: false,
		});
	});

	it('keeps https and drops paths and trailing slashes', () => {
		assert.deepEqual(parseServerUrl('https://video.example.com/bridge/api/'), {
			origin: 'https://video.example.com',
			secure: true,
		});
	});

	it('accepts ws/wss spellings', () => {
		assert.equal(parseServerUrl('wss://video.example.com').origin, 'https://video.example.com');
		assert.equal(parseServerUrl('ws://video.example.com:4309').origin, 'http://video.example.com:4309');
	});

	it('rejects empty and non-http URLs', () => {
		assert.throws(() => parseServerUrl('   '), TrueConfError);
		assert.throws(() => parseServerUrl('ftp://host'), /Unsupported protocol/);
	});
});

describe('authorization', () => {
	it('exchanges credentials for a JWT and caches it', async () => {
		const server = await startServer();
		clearTokenCache();
		const httpRequest = makeHttpRequest();
		const credentials = credentialsFor(server);

		const first = await fetchBotToken(credentials, httpRequest);
		assert.equal(first.token, 'mock-token');
		const second = await fetchBotToken(credentials, httpRequest);
		assert.equal(second.token, 'mock-token');
		assert.equal(server.state.tokenRequests, 1, 'the token must be reused while it is valid');
		assert.equal(httpRequest.calls[0].url, `${server.url}/bridge/api/client/v1/oauth/token`);
		assert.deepEqual(httpRequest.calls[0].body, {
			client_id: 'chat_bot',
			grant_type: 'password',
			username: 'bot@mock.local',
			password: 'secret',
		});
	});

	it('reports invalid credentials clearly', async () => {
		const server = await startServer();
		clearTokenCache();
		await assert.rejects(
			() => fetchBotToken(credentialsFor(server, { password: 'wrong' }), makeHttpRequest()),
			/TrueConf authorization failed: Invalid username or password/,
		);
	});
});

describe('BridgeClient', () => {
	it('authenticates over WebSocket and exposes the bot id', async () => {
		const server = await startServer();
		clearTokenCache();
		const client = new BridgeClient(credentialsFor(server), makeHttpRequest(), {});

		assert.equal(await client.whoAmI(), 'bot@mock.local/hash');
		assert.equal(client.isConnected, true);
		assert.equal(server.state.requests[0].method, 'auth');
		assert.equal(server.state.requests[0].type, 1);

		await client.close();
	});

	it('sends requests with monotonically growing ids and returns payloads', async () => {
		const server = await startServer();
		clearTokenCache();
		const client = new BridgeClient(credentialsFor(server), makeHttpRequest(), {});

		const first = await client.request('sendMessage', {
			chatId: 'chat-1',
			content: { text: 'hello', parseMode: 'text' },
		});
		const second = await client.request('sendMessage', {
			chatId: 'chat-1',
			content: { text: 'again', parseMode: 'text' },
		});

		assert.ok(first.messageId);
		assert.ok(second.messageId);
		const ids = server.state.requests.map((request) => request.id);
		assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
		assert.equal(new Set(ids).size, ids.length);

		await client.close();
	});

	it('acknowledges server notifications and forwards them to listeners', async () => {
		const server = await startServer();
		clearTokenCache();
		const client = new BridgeClient(credentialsFor(server), makeHttpRequest(), {});
		const received = [];
		client.onNotification((notification) => received.push(notification));

		await client.ensureConnected();
		await server.pushNotification('sendMessage', server.envelope({ content: { text: 'ping', parseMode: 'text' } }));

		assert.equal(received.length, 1);
		assert.equal(received[0].method, 'sendMessage');
		assert.equal(received[0].payload.content.text, 'ping');

		await client.close();
	});

	it('maps TrueConf error codes to readable errors', async () => {
		const server = await startServer();
		clearTokenCache();
		const client = new BridgeClient(credentialsFor(server), makeHttpRequest(), {});
		server.state.failNext = { method: 'sendMessage', errorCode: 201 };

		await assert.rejects(
			() => client.request('sendMessage', { chatId: 'nope', content: { text: 'x' } }),
			(error) => {
				assert.ok(error instanceof TrueConfError);
				assert.equal(error.code, 201);
				assert.match(error.message, /chat not found/);
				return true;
			},
		);

		await client.close();
	});

	it('reconnects automatically while a listener is registered', async () => {
		const server = await startServer();
		clearTokenCache();
		const client = new BridgeClient(credentialsFor(server), makeHttpRequest(), {});
		const received = [];
		client.onNotification((notification) => received.push(notification));
		await client.ensureConnected();

		for (const socket of [...server.state.connections]) {
			socket.terminate();
		}

		await waitFor(() => !client.isConnected, 3000);
		const reconnected = await waitFor(() => client.isConnected, 8000);
		assert.equal(reconnected, true, 'client should come back after a dropped socket');
		// Wait until the bot has signed in again on the server side before pushing an event.
		await waitFor(
			() => [...server.state.connections].some((socket) => socket.authorized),
			3000,
		);

		await server.pushNotification('sendMessage', server.envelope());
		assert.equal(received.length >= 1, true);

		await client.close();
	});

	it('reuses one shared client per bot', async () => {
		const server = await startServer();
		clearTokenCache();
		const httpRequest = makeHttpRequest();
		const first = getBridgeClient(credentialsFor(server), httpRequest);
		const second = getBridgeClient(credentialsFor(server), httpRequest);
		assert.equal(first, second);
		await first.close();
	});
});

describe('file upload', () => {
	it('reserves an upload task and posts multipart bytes', async () => {
		const server = await startServer();
		clearTokenCache();
		const client = new BridgeClient(credentialsFor(server), makeHttpRequest(), {});
		const httpRequest = makeHttpRequest();

		const temporalFileId = await uploadTemporalFile(
			client,
			httpRequest,
			credentialsFor(server),
			{ name: 'report.txt', data: Buffer.from('hello trueconf'), mimeType: 'text/plain' },
		);

		assert.match(temporalFileId, /^tf-/);
		assert.equal(server.state.fileUploads.length, 1);
		const upload = server.state.fileUploads[0];
		assert.equal(upload.uploadTaskId, 'task-1');
		assert.match(upload.body.toString('utf8'), /hello trueconf/);
		assert.match(upload.body.toString('utf8'), /name="file"; filename="report.txt"/);
		assert.match(upload.body.toString('utf8'), /Content-Type: text\/plain/);

		await client.close();
	});

	it('builds a valid multipart body with a preview part', () => {
		const { body, boundary } = buildMultipartBody(
			[
				{ name: 'file', filename: 'a.png', contentType: 'image/png', data: Buffer.from('AAA') },
				{ name: 'preview', filename: 'a.webp', contentType: 'image/webp', data: Buffer.from('BBB') },
			],
			'BOUNDARY',
		);
		const text = body.toString('utf8');
		assert.ok(text.startsWith('--BOUNDARY\r\n'));
		assert.ok(text.endsWith('--BOUNDARY--\r\n'));
		assert.match(text, /name="preview"; filename="a.webp"/);
		assert.match(text, /Content-Type: image\/webp/);
		assert.equal(boundary, 'BOUNDARY');
	});
});
