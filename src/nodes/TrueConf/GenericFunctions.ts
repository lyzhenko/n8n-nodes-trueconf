import { randomBytes } from 'node:crypto';

import type { IDataObject } from 'n8n-workflow';

import { bridgeApiUrl, type BridgeClient, type HttpRequestFn, type TrueConfCredentials } from './BridgeClient';

export interface FileToUpload {
	name: string;
	data: Buffer;
	mimeType?: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
	'.txt': 'text/plain',
	'.csv': 'text/csv',
	'.json': 'application/json',
	'.zip': 'application/zip',
	'.doc': 'application/msword',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.xls': 'application/vnd.ms-excel',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.ogg': 'audio/ogg',
};

export function guessMimeType(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	if (dot === -1) {
		return 'application/octet-stream';
	}
	return MIME_BY_EXTENSION[fileName.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

/** Escapes a value for use inside a multipart `Content-Disposition` header. */
function escapeDispositionValue(value: string): string {
	return value.replace(/["\r\n]/g, '_');
}

/**
 * Builds a `multipart/form-data` body by hand: TrueConf expects exactly the fields
 * `file` (required) and `preview` (optional) and ignores the filename, but Node's
 * FormData/undici formatting is not something we want to depend on across n8n versions.
 */
export function buildMultipartBody(
	parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer }>,
	boundary: string = `----TrueConfN8n${randomBytes(12).toString('hex')}`,
): { body: Buffer; boundary: string } {
	const chunks: Buffer[] = [];
	for (const part of parts) {
		const contentType = part.contentType ?? 'application/octet-stream';
		const disposition = part.filename
			? `form-data; name="${part.name}"; filename="${escapeDispositionValue(part.filename)}"`
			: `form-data; name="${part.name}"`;
		chunks.push(Buffer.from(`--${boundary}\r\n`));
		chunks.push(Buffer.from(`Content-Disposition: ${disposition}\r\n`));
		chunks.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`));
		chunks.push(part.data);
		chunks.push(Buffer.from('\r\n'));
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`));
	return { body: Buffer.concat(chunks), boundary };
}

/**
 * Uploads a file to the TrueConf file storage and returns a `temporalFileId`, which is the
 * only thing `sendFile` accepts. Two steps of the three-step upload live here:
 * `uploadFile` (WebSocket, reserves a task) and `POST /files` (HTTP, pushes the bytes).
 */
export async function uploadTemporalFile(
	client: BridgeClient,
	httpRequest: HttpRequestFn,
	credentials: TrueConfCredentials,
	file: FileToUpload,
): Promise<string> {
	const task = (await client.request('uploadFile', {
		fileSize: file.data.length,
		fileName: file.name,
	})) as { uploadTaskId?: string } | undefined;

	const uploadTaskId = task?.uploadTaskId;
	if (!uploadTaskId) {
		throw new Error('TrueConf did not return an uploadTaskId for the file');
	}

	const { body, boundary } = buildMultipartBody([
		{ name: 'file', filename: file.name, contentType: file.mimeType ?? guessMimeType(file.name), data: file.data },
	]);

	let response: unknown;
	try {
		response = await httpRequest({
			url: bridgeApiUrl(client.server, '/files'),
			method: 'POST',
			headers: {
				'Upload-Task-Id': uploadTaskId,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Content-Length': String(body.length),
			},
			body,
			json: true,
			timeout: 120_000,
			skipSslCertificateValidation: Boolean(credentials.ignoreSslIssues),
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		});
	} catch (error) {
		throw new Error(`TrueConf file upload failed: ${(error as Error).message}`);
	}

	const envelope = response as {
		statusCode?: number;
		body?: { temporalFileId?: string; error?: number; error_description?: string };
	};
	const status = envelope?.statusCode ?? 200;
	const payload = envelope?.body ?? (response as { temporalFileId?: string });

	if (status >= 300) {
		const description =
			(payload as { error_description?: string })?.error_description ?? `HTTP ${status}`;
		throw new Error(`TrueConf file upload failed: ${description}`);
	}

	const temporalFileId = (payload as { temporalFileId?: string })?.temporalFileId;
	if (!temporalFileId) {
		throw new Error('TrueConf file upload did not return a temporalFileId');
	}
	return temporalFileId;
}

/**
 * Resolves the `chatId` for an operation. A TrueConf ID (user@server) is turned into a
 * personal chat; an existing chat id is returned as is.
 */
export async function resolveChatId(
	client: BridgeClient,
	target: string,
	targetType: 'chatId' | 'userId',
): Promise<string> {
	const value = (target ?? '').trim();
	if (!value) {
		throw new Error('Chat ID (or TrueConf ID) is empty');
	}
	if (targetType === 'chatId') {
		return value;
	}
	const response = (await client.request('createP2PChat', { userId: value })) as
		| { chatId?: string }
		| undefined;
	if (!response?.chatId) {
		throw new Error(`TrueConf did not return a chat for user "${value}"`);
	}
	return response.chatId;
}

/**
 * A compact, stable representation of a TrueConf Envelope for workflow output.
 * The raw envelope is kept in `raw` so nothing is lost.
 */
export function formatEnvelope(envelope: IDataObject): IDataObject {
	const chat = (envelope.chat ?? {}) as IDataObject;
	const author = (envelope.author ?? {}) as IDataObject;
	const content = (envelope.content ?? {}) as IDataObject;
	const type = envelope.type as number | undefined;

	const result: IDataObject = {
		messageId: envelope.messageId,
		chatId: chat.chatId ?? envelope.chatId,
		chatTitle: chat.chatTitle ?? null,
		chatType: chat.chatType,
		authorId: author.id,
		authorType: author.type === 0 ? 'system' : 'user',
		timestamp: envelope.timestamp,
		type,
		contentType: describeContentType(type),
		text: content.text ?? null,
		parseMode: content.parseMode ?? null,
		isEdited: envelope.isEdited ?? false,
		replyMessageId: envelope.replyMessageId ?? null,
		raw: envelope,
	};

	if (type === 202) {
		result.fileName = content.name;
		result.fileId = content.fileId;
		result.fileSize = content.size;
		result.mimeType = content.mimeType;
	}

	return result;
}

export function describeContentType(type: number | undefined): string {
	switch (type) {
		case 200:
			return 'text';
		case 201:
			return 'forwarded';
		case 202:
			return 'file';
		case 203:
			return 'location';
		case 204:
			return 'survey';
		case 205:
			return 'voice';
		case 1:
			return 'participantAdded';
		case 2:
			return 'participantRemoved';
		case 21:
			return 'chatTitleChanged';
		case 22:
			return 'chatAvatarChanged';
		case 23:
			return 'historyCleared';
		case 110:
			return 'participantRoleChanged';
		default:
			return type !== undefined && type < 200 ? 'system' : 'unknown';
	}
}

/** Extracts the TrueConf ID of the bot from an auth/user identifier that may carry a suffix. */
export function bareTrueConfId(id: string | undefined): string {
	if (!id) {
		return '';
	}
	const slash = id.indexOf('/');
	return slash === -1 ? id : id.slice(0, slash);
}
