import { createHash } from 'node:crypto';

import type { IHttpRequestOptions } from 'n8n-workflow';
import WebSocket from 'ws';

/** Credentials as stored in n8n (see credentials/TrueConfApi.credentials.ts). */
export interface TrueConfCredentials {
	baseUrl: string;
	username: string;
	password: string;
	ignoreSslIssues?: boolean;
}

export type HttpRequestFn = (options: IHttpRequestOptions) => Promise<unknown>;

/** Payload of a server notification (`type: 1` frames initiated by TrueConf). */
export interface BridgeNotification {
	method: string;
	id: number;
	payload: unknown;
}

export type NotificationHandler = (notification: BridgeNotification) => void | Promise<void>;

const TOKEN_SAFETY_WINDOW_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const IDLE_SOCKET_TIMEOUT_MS = 10 * 60_000;
const RECONNECT_MIN_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const WS_PATH = '/websocket/chat_bot/';
const API_PREFIX = '/bridge/api/client/v1';

export class TrueConfError extends Error {
	constructor(
		message: string,
		readonly code?: number,
	) {
		super(message);
		this.name = 'TrueConfError';
	}
}

export interface ServerUrl {
	/** Scheme + host + port, without a trailing slash, e.g. `http://192.168.0.11:4309`. */
	origin: string;
	secure: boolean;
}

/**
 * Accepts `192.168.0.11:4309`, `http://host`, `https://host:443/`, `wss://host` and returns
 * a normalized origin. Any path/query is dropped: TrueConf Bridge always lives at the
 * server root (`/bridge/api/client/v1`, `/websocket/chat_bot/`), also when it is reached
 * through TrueConf Web Manager.
 */
export function parseServerUrl(raw: string): ServerUrl {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) {
		throw new TrueConfError('TrueConf Server URL is not configured');
	}

	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new TrueConfError(`Invalid TrueConf Server URL: "${raw}"`);
	}

	let protocol = url.protocol.toLowerCase();
	if (protocol === 'ws:') protocol = 'http:';
	if (protocol === 'wss:') protocol = 'https:';

	if (protocol !== 'http:' && protocol !== 'https:') {
		throw new TrueConfError(
			`Unsupported protocol "${url.protocol}" in TrueConf Server URL: expected http or https`,
		);
	}

	if (!url.hostname) {
		throw new TrueConfError(`TrueConf Server URL has no host: "${raw}"`);
	}

	return {
		origin: `${protocol}//${url.host}`,
		secure: protocol === 'https:',
	};
}

export function bridgeApiUrl(server: ServerUrl, path: string): string {
	return `${server.origin}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
}

export function bridgeWebSocketUrl(server: ServerUrl): string {
	return `${server.secure ? 'wss' : 'ws'}://${server.origin.replace(/^https?:\/\//, '')}${WS_PATH}`;
}

interface CachedToken {
	token: string;
	expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function clearTokenCache(): void {
	tokenCache.clear();
}

function tokenCacheKey(credentials: TrueConfCredentials, server: ServerUrl): string {
	const passwordHash = createHash('sha1').update(credentials.password ?? '').digest('hex');
	return `${server.origin}|${credentials.username}|${passwordHash}`;
}

function readHttpError(error: unknown): { status?: number; body?: unknown; message: string } {
	const candidate = error as {
		httpCode?: number;
		statusCode?: number;
		message?: string;
		response?: { body?: unknown; status?: number };
		body?: unknown;
	};

	const status = candidate?.httpCode ?? candidate?.statusCode ?? candidate?.response?.status;
	const body = candidate?.response?.body ?? candidate?.body;
	const message =
		(typeof body === 'object' && body !== null && 'error_description' in body
			? String((body as Record<string, unknown>).error_description)
			: undefined) ??
		(typeof body === 'object' && body !== null && 'error' in body
			? String((body as Record<string, unknown>).error)
			: undefined) ??
		candidate?.message ??
		String(error);

	return { status, body, message };
}

/**
 * Exchanges bot credentials for a JWT (POST /oauth/token). The token lives for one month,
 * so it is cached per server+user+password and re-requested only when it is about to expire.
 */
export async function fetchBotToken(
	credentials: TrueConfCredentials,
	httpRequest: HttpRequestFn,
	forceRefresh = false,
): Promise<{ token: string; server: ServerUrl }> {
	const server = parseServerUrl(credentials.baseUrl);
	const key = tokenCacheKey(credentials, server);

	if (!forceRefresh) {
		const cached = tokenCache.get(key);
		if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
			return { token: cached.token, server };
		}
	}

	let response: unknown;
	try {
		response = await httpRequest({
			url: bridgeApiUrl(server, '/oauth/token'),
			method: 'POST',
			body: {
				client_id: 'chat_bot',
				grant_type: 'password',
				username: credentials.username,
				password: credentials.password,
			},
			json: true,
			timeout: 20_000,
			skipSslCertificateValidation: Boolean(credentials.ignoreSslIssues),
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		});
	} catch (error) {
		const { message } = readHttpError(error);
		throw new TrueConfError(`TrueConf authorization failed: ${message}`);
	}

	const envelope = response as {
		statusCode?: number;
		body?: { access_token?: string; expires_at?: number; error?: string; error_description?: string };
	};

	const status = envelope?.statusCode ?? 200;
	const body =
		envelope?.body ??
		(response as {
			access_token?: string;
			expires_at?: number;
			error?: string;
			error_description?: string;
		});

	if (status === 403 && (body as { error?: string })?.error === 'auth_method_disabled') {
		throw new TrueConfError(
			'TrueConf server rejected password authorization (auth_method_disabled). ' +
				'Password sign-in is disabled for this server — use an account that may sign in with a password.',
			403,
		);
	}

	if (status === 400 || status === 401 || status === 403) {
		const description = body?.error_description ?? body?.error ?? `HTTP ${status}`;
		throw new TrueConfError(`TrueConf authorization failed: ${description}`, status);
	}

	if (status >= 300) {
		throw new TrueConfError(`TrueConf authorization failed with HTTP ${status}`, status);
	}

	const token = body?.access_token;
	if (!token) {
		throw new TrueConfError('TrueConf authorization response did not contain an access token');
	}

	// `expires_at` is a Unix timestamp in seconds (one month ahead).
	const expiresAt =
		typeof body?.expires_at === 'number' && body.expires_at > 0
			? body.expires_at * 1000
			: Date.now() + 30 * 24 * 60 * 60 * 1000;

	tokenCache.set(key, { token, expiresAt });
	return { token, server };
}

interface PendingRequest {
	resolve: (payload: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

export interface BridgeClientOptions {
	receiveUnread?: boolean;
	receiveSystemMessageEnvelopes?: boolean;
}

/**
 * A single TrueConf Bridge WebSocket session for one bot.
 *
 * Implements the request/response envelope (`{type:1,id,method,payload}` ->
 * `{type:2,id,payload}`), acknowledges every server notification within the 300 s window,
 * multiplexes concurrent requests by id and reconnects with exponential backoff while a
 * trigger is listening.
 */
export class BridgeClient {
	private socket?: WebSocket;
	private connecting?: Promise<void>;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly handlers = new Set<NotificationHandler>();
	private nextId = 1;
	private lastActivity = Date.now();
	private reconnectAttempt = 0;
	private reconnectTimer?: NodeJS.Timeout;
	private idleTimer?: NodeJS.Timeout;
	private closedByUser = false;
	private expiredTokenRetried = false;
	readonly server: ServerUrl;
	private userId?: string;

	constructor(
		private readonly credentials: TrueConfCredentials,
		private readonly httpRequest: HttpRequestFn,
		private readonly options: BridgeClientOptions = {},
	) {
		this.server = parseServerUrl(credentials.baseUrl);
	}

	get isConnected(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	get botUserId(): string | undefined {
		return this.userId;
	}

	/**
	 * TrueConf ID of the logged-in bot. Requires an authenticated connection, so it doubles
	 * as a readiness check used by the "Get Bot Info" operation.
	 */
	async whoAmI(): Promise<string | undefined> {
		await this.ensureConnected();
		return this.userId;
	}

	async ensureConnected(): Promise<void> {
		this.closedByUser = false;
		if (this.isConnected) {
			this.touch();
			return;
		}
		if (!this.connecting) {
			this.connecting = this.connectOnce().finally(() => {
				this.connecting = undefined;
			});
		}
		await this.connecting;
		this.touch();
	}

	private async connectOnce(): Promise<void> {
		// Fail fast on bad credentials: a clear HTTP error beats a WebSocket handshake failure.
		await fetchBotToken(this.credentials, this.httpRequest);

		const url = bridgeWebSocketUrl(this.server);
		const socket = new WebSocket(url, ['json.v1'], {
			handshakeTimeout: 15_000,
			rejectUnauthorized: !this.credentials.ignoreSslIssues,
		});
		this.socket = socket;
		this.attachSocketHandlers(socket);

		await this.waitForOpen(socket, url);
		await this.authenticate();
		this.reconnectAttempt = 0;
	}

	private waitForOpen(socket: WebSocket, url: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const settle = (error?: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				socket.off('open', onOpen);
				socket.off('error', onError);
				socket.off('unexpected-response', onUnexpectedResponse);
				socket.off('close', onClose);
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};

			const onOpen = () => settle();
			const onError = (error: Error) =>
				settle(new TrueConfError(`WebSocket connection to ${url} failed: ${error.message}`));
			const onUnexpectedResponse = (
				_request: unknown,
				response: { statusCode?: number; statusMessage?: string },
			) => {
				socket.terminate();
				settle(
					new TrueConfError(
						`WebSocket handshake at ${url} was rejected with HTTP ${response.statusCode}. ` +
							'Check the server URL and that the TrueConf Bridge service is running.',
						response.statusCode,
					),
				);
			};
			const onClose = (code: number) =>
				settle(new TrueConfError(`TrueConf closed the WebSocket connection during sign-in (code ${code})`));

			const timer = setTimeout(
				() => settle(new TrueConfError(`Timed out connecting to ${url}`)),
				20_000,
			);
			timer.unref?.();

			socket.on('open', onOpen);
			socket.on('error', onError);
			socket.on('unexpected-response', onUnexpectedResponse);
			socket.on('close', onClose);
		});
	}

	private async authenticate(): Promise<void> {
		const { token } = await fetchBotToken(this.credentials, this.httpRequest);
		const payload: Record<string, unknown> = {
			token,
			tokenType: 'JWT',
			receiveUnread: this.options.receiveUnread ?? false,
		};
		if (this.options.receiveSystemMessageEnvelopes !== undefined) {
			payload.receiveSystemMessageEnvelopes = this.options.receiveSystemMessageEnvelopes;
		}

		const response = (await this.sendRequest('auth', payload)) as { userId?: string } | undefined;
		this.userId = response?.userId;
	}

	private attachSocketHandlers(socket: WebSocket): void {
		socket.on('message', (raw: WebSocket.RawData) => {
			if (this.socket !== socket) {
				return;
			}
			this.onFrame(raw.toString());
		});

		socket.on('close', (code: number, reason: Buffer) => {
			if (this.socket !== socket) {
				return;
			}
			this.rejectAllPending(
				new TrueConfError(
					`TrueConf closed the WebSocket connection (code ${code}${reason?.length ? `, ${reason.toString()}` : ''})`,
				),
			);
			this.socket = undefined;
			if (!this.closedByUser && this.handlers.size > 0) {
				this.scheduleReconnect();
			}
		});

		socket.on('error', (error: Error) => {
			if (this.socket !== socket) {
				return;
			}
			// Per-request errors arrive as responses; a socket-level error only precedes a close.
			this.rejectAllPending(new TrueConfError(`TrueConf WebSocket error: ${error.message}`));
		});
	}

	private onFrame(raw: string): void {
		this.touch();

		let frame: { type?: number; id?: number; method?: string; payload?: unknown };
		try {
			frame = JSON.parse(raw);
		} catch {
			return;
		}

		if (frame.type === 2 && typeof frame.id === 'number') {
			const pending = this.pending.get(frame.id);
			if (!pending) {
				return;
			}
			this.pending.delete(frame.id);
			clearTimeout(pending.timer);

			const errorPayload = frame.payload as { errorCode?: number } | undefined;
			if (errorPayload && typeof errorPayload.errorCode === 'number') {
				pending.reject(describeError(errorPayload.errorCode, frame.payload));
				return;
			}
			pending.resolve(frame.payload);
			return;
		}

		if (frame.type === 1 && typeof frame.id === 'number' && typeof frame.method === 'string') {
			// Acknowledge first: unacknowledged notifications kill the session after 300 s.
			this.write({ type: 2, id: frame.id });

			if (frame.method === 'sendMessage') {
				this.expiredTokenRetried = false;
			}

			const notification: BridgeNotification = {
				method: frame.method,
				id: frame.id,
				payload: frame.payload,
			};

			for (const handler of this.handlers) {
				try {
					Promise.resolve(handler(notification)).catch(() => {
						/* handler failures must not break the session */
					});
				} catch {
					/* ignore synchronous handler failures */
				}
			}
		}
	}

	private write(frame: Record<string, unknown>): void {
		if (!this.isConnected) {
			return;
		}
		try {
			this.socket!.send(JSON.stringify(frame));
		} catch {
			/* the close handler will deal with a dead socket */
		}
	}

	private sendRequest(
		method: string,
		payload?: Record<string, unknown>,
		timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<unknown> {
		if (!this.isConnected) {
			return Promise.reject(new TrueConfError('TrueConf WebSocket is not connected'));
		}

		const id = this.nextId++;
		const frame: Record<string, unknown> = { type: 1, id, method };
		if (payload !== undefined) {
			frame.payload = payload;
		}

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new TrueConfError(`TrueConf did not answer "${method}" within ${timeoutMs / 1000}s`));
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timer });
			this.write(frame);
		});
	}

	/**
	 * Sends a request and returns its payload. Reconnects transparently (once) when the
	 * session was lost between executions; an expired token triggers a token refresh+reconnect.
	 */
	async request(
		method: string,
		payload?: Record<string, unknown>,
		timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<unknown> {
		await this.ensureConnected();
		this.touch();

		try {
			return await this.sendRequest(method, payload, timeoutMs);
		} catch (error) {
			const code = error instanceof TrueConfError ? error.code : undefined;
			// 203 = TOKEN_EXPIRED / 200 = NOT_AUTHORIZED: refresh the JWT and retry once.
			if ((code === 203 || code === 200) && !this.expiredTokenRetried) {
				this.expiredTokenRetried = true;
				clearTokenCache();
				await this.reconnect(true);
				try {
					return await this.sendRequest(method, payload, timeoutMs);
				} finally {
					this.expiredTokenRetried = false;
				}
			}
			throw error;
		} finally {
			// Action-only usage keeps the socket for reuse; close it after a quiet period.
			if (this.handlers.size === 0) {
				this.scheduleIdleClose();
			}
		}
	}

	onNotification(handler: NotificationHandler): () => void {
		this.handlers.add(handler);
		this.closedByUser = false;
		this.touch();
		return () => {
			this.handlers.delete(handler);
			this.touch();
			if (this.handlers.size === 0) {
				this.scheduleIdleClose();
			}
		};
	}

	private touch(): void {
		this.lastActivity = Date.now();
		this.clearIdleTimer();
	}

	private clearIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = undefined;
		}
	}

	private scheduleIdleClose(): void {
		this.clearIdleTimer();
		this.idleTimer = setTimeout(() => {
			if (this.handlers.size === 0 && this.pending.size === 0) {
				void this.close();
			} else {
				this.scheduleIdleClose();
			}
		}, IDLE_SOCKET_TIMEOUT_MS);
		this.idleTimer.unref?.();
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer || this.closedByUser) {
			return;
		}
		const delay = Math.min(
			RECONNECT_MAX_DELAY_MS,
			RECONNECT_MIN_DELAY_MS * 2 ** this.reconnectAttempt,
		);
		this.reconnectAttempt += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			this.ensureConnected().catch(() => {
				this.scheduleReconnect();
			});
		}, delay);
		this.reconnectTimer.unref?.();
	}

	private async reconnect(forceReconnect: boolean): Promise<void> {
		if (forceReconnect) {
			this.closedByUser = false;
			const socket = this.socket;
			this.socket = undefined;
			socket?.removeAllListeners();
			socket?.terminate();
		}
		await this.ensureConnected();
	}

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}

	async close(): Promise<void> {
		this.closedByUser = true;
		this.handlers.clear();
		this.clearIdleTimer();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.rejectAllPending(new TrueConfError('TrueConf client was closed'));
		const socket = this.socket;
		this.socket = undefined;
		if (socket) {
			socket.removeAllListeners();
			if (socket.readyState === WebSocket.OPEN) {
				await new Promise<void>((resolve) => {
					socket.once('close', () => resolve());
					socket.close(1000, 'client closing');
					setTimeout(() => {
						socket.terminate();
						resolve();
					}, 1_000).unref?.();
				});
			} else {
				socket.terminate();
			}
		}
		removeFromRegistry(this);
	}

	/** Debug helper: human-readable connection state for node output. */
	describe(): Record<string, unknown> {
		return {
			server: this.server.origin,
			webSocketUrl: bridgeWebSocketUrl(this.server),
			connected: this.isConnected,
			botUserId: this.userId,
			activeListeners: this.handlers.size,
		};
	}
}

const ERROR_MESSAGES: Record<number, string> = {
	2: 'request id is invalid (must increase monotonically)',
	200: 'not authorized (auth request is missing or rejected)',
	201: 'chat not found',
	202: 'message not found',
	203: 'token expired',
	204: 'user not found',
	205: 'forbidden: the bot has no rights for this action',
	300: 'internal server error',
	301: 'invalid payload',
	303: 'file not found',
	304: 'upload task not found',
	310: 'file is too large or has a forbidden extension',
	399: 'wrong payload format',
};

function describeError(code: number, payload: unknown): TrueConfError {
	const record = (payload ?? {}) as Record<string, unknown>;
	const description =
		(typeof record.errorDescription === 'string' && record.errorDescription) ||
		(typeof record.error_description === 'string' && record.error_description) ||
		ERROR_MESSAGES[code] ||
		'unknown error';
	return new TrueConfError(`TrueConf API error ${code}: ${description}`, code);
}

// ---------------------------------------------------------------------------------------------
// Shared client registry: one WebSocket session per (server, bot), reused by every node run.
// ---------------------------------------------------------------------------------------------

const registry = new Map<string, BridgeClient>();

function registryKey(credentials: TrueConfCredentials): string {
	const server = parseServerUrl(credentials.baseUrl);
	return tokenCacheKey(credentials, server);
}

function removeFromRegistry(client: BridgeClient): void {
	for (const [key, value] of registry) {
		if (value === client) {
			registry.delete(key);
		}
	}
}

export function getBridgeClient(
	credentials: TrueConfCredentials,
	httpRequest: HttpRequestFn,
	options: BridgeClientOptions = {},
): BridgeClient {
	const key = registryKey(credentials);
	const existing = registry.get(key);
	if (existing) {
		return existing;
	}
	const client = new BridgeClient(credentials, httpRequest, options);
	registry.set(key, client);
	return client;
}

/** Used by tests and by the "disconnect" cleanup path. */
export async function closeAllBridgeClients(): Promise<void> {
	const clients = [...registry.values()];
	registry.clear();
	await Promise.all(clients.map(async (client) => client.close()));
}

export function listBridgeClients(): BridgeClient[] {
	return [...registry.values()];
}
