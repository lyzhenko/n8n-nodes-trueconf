import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getBridgeClient, type HttpRequestFn, type TrueConfCredentials } from './BridgeClient';
import {
	formatEnvelope,
	guessMimeType,
	resolveChatId,
	uploadTemporalFile,
} from './GenericFunctions';
import { messageDescription } from './descriptions/MessageDescription';
import { chatDescription } from './descriptions/ChatDescription';
import { botDescription } from './descriptions/BotDescription';

/** TrueConf IDs always contain "@" (user@server); chat ids are hex hashes. */
function looksLikeTrueConfId(value: string): boolean {
	return value.includes('@') || value.includes('\\');
}

export class TrueConf implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TrueConf',
		name: 'trueConf',
		icon: 'file:trueconf.svg',
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send messages and files to TrueConf chats with a chatbot',
		defaults: {
			name: 'TrueConf',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'trueConfApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Message', value: 'message' },
					{ name: 'Chat', value: 'chat' },
					{ name: 'Bot', value: 'bot' },
				],
				default: 'message',
			},
			...messageDescription,
			...chatDescription,
			...botDescription,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = (await this.getCredentials('trueConfApi')) as unknown as TrueConfCredentials;
		const httpRequest: HttpRequestFn = (options) => this.helpers.httpRequest(options);
		const client = getBridgeClient(credentials, httpRequest);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'message') {
					returnData.push(...(await handleMessage.call(this, i, operation, client, credentials)));
				} else if (resource === 'chat') {
					returnData.push(...(await handleChat.call(this, i, operation, client)));
				} else if (resource === 'bot') {
					returnData.push(...(await handleBot.call(this, i, operation, client)));
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, {
						itemIndex: i,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

type BridgeClientInstance = ReturnType<typeof getBridgeClient>;

async function resolveTargetChatId(
	context: IExecuteFunctions,
	itemIndex: number,
	client: BridgeClientInstance,
): Promise<string> {
	const chat = (context.getNodeParameter('chatId', itemIndex) as string) ?? '';
	const value = chat.trim();
	if (!value) {
		throw new NodeOperationError(
			context.getNode(),
			'Chat ID is empty. Provide a chat ID or a TrueConf ID (user@server) to create a personal chat.',
			{ itemIndex },
		);
	}
	if (!looksLikeTrueConfId(value)) {
		return value;
	}
	return await resolveChatId(client, value, 'userId');
}

async function handleMessage(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	client: BridgeClientInstance,
	credentials: TrueConfCredentials,
): Promise<INodeExecutionData[]> {
	if (operation === 'sendMessage') {
		const chatId = await resolveTargetChatId(this, itemIndex, client);
		const text = this.getNodeParameter('text', itemIndex) as string;
		const parseMode = this.getNodeParameter('parseMode', itemIndex, 'text') as string;
		const replyToMessageId = (this.getNodeParameter('replyToMessageId', itemIndex, '') as string)?.trim();

		const payload: Record<string, unknown> = {
			chatId,
			content: { text, parseMode },
		};
		if (replyToMessageId) {
			payload.replyMessageId = replyToMessageId;
		}

		const response = (await client.request('sendMessage', payload)) as IDataObject;
		return [{ json: { ...response, chatId: response.chatId ?? chatId }, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'sendFile') {
		const chatId = await resolveTargetChatId(this, itemIndex, client);
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string;
		const caption = (this.getNodeParameter('caption', itemIndex, '') as string) ?? '';
		const parseMode = this.getNodeParameter('captionParseMode', itemIndex, 'text') as string;
		const replyToMessageId = (this.getNodeParameter('replyToMessageId', itemIndex, '') as string)?.trim();

		const binaryMetadata = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
		const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
		const fileName = binaryMetadata.fileName ?? `file-${Date.now()}`;

		const temporalFileId = await uploadTemporalFile(
			client,
			(options) => this.helpers.httpRequest(options),
			credentials,
			{
				name: fileName,
				data: buffer,
				mimeType: binaryMetadata.mimeType ?? guessMimeType(fileName),
			},
		);

		const content: Record<string, unknown> = { temporalFileId };
		if (caption) {
			content.caption = { text: caption, parseMode };
		}
		const payload: Record<string, unknown> = { chatId, content };
		if (replyToMessageId) {
			payload.replyMessageId = replyToMessageId;
		}

		const response = (await client.request('sendFile', payload)) as IDataObject;
		return [{ json: { ...response, chatId: response.chatId ?? chatId }, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'editMessage') {
		const messageId = this.getNodeParameter('messageId', itemIndex) as string;
		const text = this.getNodeParameter('text', itemIndex) as string;
		const parseMode = this.getNodeParameter('parseMode', itemIndex, 'text') as string;
		const response = (await client.request('editMessage', {
			messageId,
			content: { text, parseMode },
		})) as IDataObject;
		return [{ json: { ...response, messageId }, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'deleteMessage') {
		const messageId = this.getNodeParameter('messageId', itemIndex) as string;
		const forAll = this.getNodeParameter('forAll', itemIndex, true) as boolean;
		const response = (await client.request('removeMessage', { messageId, forAll })) as IDataObject;
		return [{ json: { ...response, messageId, deleted: true }, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'forwardMessage') {
		const chatId = await resolveTargetChatId(this, itemIndex, client);
		const messageId = this.getNodeParameter('messageId', itemIndex) as string;
		const response = (await client.request('forwardMessage', { chatId, messageId })) as IDataObject;
		return [{ json: { ...response, chatId }, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'getMessage') {
		const messageId = this.getNodeParameter('messageId', itemIndex) as string;
		const response = (await client.request('getMessageById', { messageId })) as IDataObject;
		return [{ json: formatEnvelope(response), pairedItem: { item: itemIndex } }];
	}

	if (operation === 'getHistory') {
		const chatId = await resolveTargetChatId(this, itemIndex, client);
		const count = this.getNodeParameter('count', itemIndex, 20) as number;
		const fromMessageId = (this.getNodeParameter('fromMessageId', itemIndex, '') as string)?.trim();

		const payload: Record<string, unknown> = { chatId, count };
		// The server rejects `fromMessageId: null`, so the key must be absent when unused.
		if (fromMessageId) {
			payload.fromMessageId = fromMessageId;
		}

		const response = (await client.request('getChatHistory', payload)) as {
			messages?: IDataObject[];
		};
		const messages = response?.messages ?? [];
		if (messages.length === 0) {
			return [{ json: { chatId, messages: [], count: 0 }, pairedItem: { item: itemIndex } }];
		}
		return messages.map((message) => ({
			json: formatEnvelope(message),
			pairedItem: { item: itemIndex },
		}));
	}

	throw new NodeOperationError(this.getNode(), `Unknown message operation "${operation}"`, {
		itemIndex,
	});
}

async function handleChat(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	client: BridgeClientInstance,
): Promise<INodeExecutionData[]> {
	if (operation === 'getChats') {
		const count = this.getNodeParameter('count', itemIndex, 10) as number;
		const page = this.getNodeParameter('page', itemIndex, 1) as number;
		const response = (await client.request('getChats', { count, page })) as IDataObject[] | undefined;
		const chats = Array.isArray(response) ? response : [];
		if (chats.length === 0) {
			return [{ json: { chats: [], count: 0, page }, pairedItem: { item: itemIndex } }];
		}
		return chats.map((chat) => ({ json: chat, pairedItem: { item: itemIndex } }));
	}

	if (operation === 'getChat') {
		const chatId = this.getNodeParameter('chatId', itemIndex) as string;
		const response = (await client.request('getChatByID', { chatId: chatId.trim() })) as IDataObject;
		return [{ json: response, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'createP2PChat') {
		const userId = (this.getNodeParameter('userId', itemIndex) as string).trim();
		const response = (await client.request('createP2PChat', { userId })) as IDataObject;
		return [{ json: { ...response, userId }, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'createGroupChat' || operation === 'createChannel') {
		const title = (this.getNodeParameter('title', itemIndex) as string).trim();
		const method = operation === 'createChannel' ? 'createChannel' : 'createGroupChat';
		const response = (await client.request(method, { title })) as IDataObject;
		return [{ json: { ...response, title }, pairedItem: { item: itemIndex } }];
	}

	if (operation === 'getParticipants') {
		const chatId = this.getNodeParameter('chatId', itemIndex) as string;
		const response = (await client.request('getChatParticipants', { chatId: chatId.trim() })) as
			| IDataObject[]
			| IDataObject;
		const participants = Array.isArray(response) ? response : [response];
		return participants.map((participant) => ({
			json: participant,
			pairedItem: { item: itemIndex },
		}));
	}

	throw new NodeOperationError(this.getNode(), `Unknown chat operation "${operation}"`, {
		itemIndex,
	});
}

async function handleBot(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	client: BridgeClientInstance,
): Promise<INodeExecutionData[]> {
	if (operation === 'getBotInfo') {
		const userId = await client.whoAmI();
		return [
			{
				json: {
					userId,
					...client.describe(),
				},
				pairedItem: { item: itemIndex },
			},
		];
	}

	throw new NodeOperationError(this.getNode(), `Unknown bot operation "${operation}"`, {
		itemIndex,
	});
}
