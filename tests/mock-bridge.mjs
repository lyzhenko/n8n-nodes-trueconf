/**
 * Minimal in-memory imitation of TrueConf Bridge (Chatbot Connector).
 *
 * Implements the parts of the protocol the n8n node depends on:
 *   POST /bridge/api/client/v1/oauth/token   — password grant -> JWT
 *   POST /bridge/api/client/v1/files         — multipart upload -> temporalFileId
 *   WS   /websocket/chat_bot/                — auth + request/response + notifications
 *
 * It is intentionally strict about framing (ids must grow, every notification must be acked)
 * because those rules are what the real server enforces.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { WebSocketServer } from 'ws';

export async function createMockTrueConf(options = {}) {
	const config = {
		username: 'bot@mock.local',
		password: 'secret',
		tokenTtlSeconds: 3600,
		...options,
	};

	const state = {
		tokenRequests: 0,
		requests: [],
		notifications: [],
		fileUploads: [],
		connections: new Set(),
		failNext: undefined,
		disconnectNext: false,
	};

	const sendJson = (res, status, body) => {
		const payload = JSON.stringify(body);
		res.writeHead(status, {
			'content-type': 'application/json',
			'content-length': Buffer.byteLength(payload),
		});
		res.end(payload);
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			const chunks = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => resolve(Buffer.concat(chunks)));
			req.on('error', reject);
		});

	const httpServer = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');

		if (req.method === 'POST' && url.pathname === '/bridge/api/client/v1/oauth/token') {
			state.tokenRequests += 1;
			const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
			if (body.client_id !== 'chat_bot' || body.grant_type !== 'password') {
				sendJson(res, 400, { error: 'invalid_request' });
				return;
			}
			if (body.username !== config.username || body.password !== config.password) {
				sendJson(res, 400, {
					error: 'invalid_grant',
					error_description: 'Invalid username or password',
				});
				return;
			}
			sendJson(res, 201, {
				access_token: 'mock-token',
				token_type: 'JWT',
				expires_at: Math.floor(Date.now() / 1000) + config.tokenTtlSeconds,
			});
			return;
		}

		if (req.method === 'POST' && url.pathname === '/bridge/api/client/v1/files') {
			const uploadTaskId = req.headers['upload-task-id'];
			const body = await readBody(req);
			state.fileUploads.push({ uploadTaskId, body });
			if (!uploadTaskId) {
				sendJson(res, 400, { error: 310, error_description: 'No upload task ID provided' });
				return;
			}
			sendJson(res, 200, { temporalFileId: `tf-${randomUUID()}` });
			return;
		}

		sendJson(res, 404, { error: 'not_found', path: url.pathname });
	});

	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (req, socket, head) => {
		if (!req.url.startsWith('/websocket/chat_bot/')) {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	});

	const envelope = (overrides = {}) => ({
		chat: { chatId: 'chat-1', chatTitle: 'Mock chat', chatType: 2 },
		chatId: 'chat-1',
		messageId: randomUUID(),
		timestamp: Date.now(),
		author: { id: 'user@mock.local', type: 1 },
		box: { id: 1, position: '0' },
		type: 200,
		content: { text: 'hello', parseMode: 'text' },
		isEdited: false,
		...overrides,
	});

	const handlers = {
		auth: (payload, ws) => {
			if (payload?.token !== 'mock-token') {
				return { errorCode: 200 };
			}
			ws.botId = config.username;
			ws.authorized = true;
			return { userId: `${config.username}/hash` };
		},
		sendMessage: (payload) => ({
			chatId: payload.chatId,
			messageId: randomUUID(),
			timestamp: Date.now(),
		}),
		sendFile: (payload) => ({
			chatId: payload.chatId,
			messageId: randomUUID(),
			timestamp: Date.now(),
			fileId: 'file-1',
		}),
		uploadFile: () => ({ uploadTaskId: 'task-1' }),
		editMessage: (payload) => ({ messageId: payload.messageId, timestamp: Date.now() }),
		removeMessage: () => ({}),
		forwardMessage: (payload) => ({
			chatId: payload.chatId,
			messageId: randomUUID(),
			timestamp: Date.now(),
		}),
		getMessageById: (payload) => envelope({ messageId: payload.messageId }),
		getChatHistory: (payload) => ({
			chatId: payload.chatId,
			count: 2,
			messages: [
				envelope({ chatId: payload.chatId, content: { text: 'newest', parseMode: 'text' } }),
				envelope({ chatId: payload.chatId, content: { text: 'older', parseMode: 'text' } }),
			],
		}),
		getChats: () => [
			{ chatId: 'chat-1', title: 'Mock chat', chatType: 2, unreadMessages: 0, lastMessage: {} },
			{ chatId: 'chat-2', title: 'user@mock.local', chatType: 1, unreadMessages: 1, lastMessage: {} },
		],
		getChatByID: (payload) => ({ chatId: payload.chatId, title: 'Mock chat', chatType: 2 }),
		createP2PChat: (payload) => ({ chatId: `p2p-${payload.userId}` }),
		createGroupChat: () => ({ chatId: `group-${randomUUID()}` }),
		createChannel: () => ({ chatId: `channel-${randomUUID()}` }),
		getChatParticipants: () => [
			{ userId: 'user@mock.local', role: 'user' },
			{ userId: config.username, role: 'owner' },
		],
	};

	wss.on('connection', (ws) => {
		state.connections.add(ws);
		let lastRequestId = 0;
		ws.ackedIds = [];
		ws.on('close', () => state.connections.delete(ws));

		ws.on('message', (raw) => {
			const frame = JSON.parse(raw.toString());
			state.requests.push(frame);

			if (frame.type === 2) {
				ws.ackedIds.push(frame.id);
				return;
			}

			if (frame.type !== 1) {
				return;
			}

			if (frame.id <= lastRequestId) {
				ws.send(JSON.stringify({ type: 2, id: frame.id, payload: { errorCode: 2 } }));
				return;
			}
			lastRequestId = frame.id;

			if (state.disconnectNext) {
				state.disconnectNext = false;
				ws.terminate();
				return;
			}

			if (state.failNext && state.failNext.method === frame.method) {
				const { errorCode } = state.failNext;
				state.failNext = undefined;
				ws.send(JSON.stringify({ type: 2, id: frame.id, payload: { errorCode } }));
				return;
			}

			const handler = handlers[frame.method];
			if (!handler) {
				ws.send(JSON.stringify({ type: 2, id: frame.id, payload: { errorCode: 301 } }));
				return;
			}

			const result = handler(frame.payload, ws);
			if (result?.errorCode) {
				ws.send(JSON.stringify({ type: 2, id: frame.id, payload: result }));
				return;
			}
			ws.send(
				JSON.stringify({
					type: 2,
					id: frame.id,
					payload: result ?? {},
				}),
			);
		});
	});

	await new Promise((resolve) => httpServer.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
	const { port } = httpServer.address();

	let notificationId = 1000;

	/** Pushes a server notification to every authorized socket and waits for the acks. */
	async function pushNotification(method, payload) {
		const sockets = [...state.connections].filter((ws) => ws.authorized);
		const id = notificationId++;
		const record = { method, id, payload };
		state.notifications.push(record);

		for (const ws of sockets) {
			ws.send(JSON.stringify({ method, type: 1, id, payload }));
		}

		const deadline = Date.now() + 2000;
		while (Date.now() < deadline) {
			if (sockets.every((ws) => ws.ackedIds.includes(id))) {
				return record;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`notification ${method}#${id} was not acknowledged in time`);
	}

	async function close() {
		for (const ws of state.connections) {
			ws.terminate();
		}
		await new Promise((resolve) => wss.close(resolve));
		await new Promise((resolve) => httpServer.close(resolve));
	}

	return {
		url: `http://127.0.0.1:${port}`,
		port,
		state,
		pushNotification,
		envelope,
		close,
	};
}
