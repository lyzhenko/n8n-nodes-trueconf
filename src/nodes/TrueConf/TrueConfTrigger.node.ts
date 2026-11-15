import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { BridgeClient, type BridgeNotification, type TrueConfCredentials } from './BridgeClient';
import { bareTrueConfId, formatEnvelope } from './GenericFunctions';

type TriggerEvent =
	| 'message'
	| 'command'
	| 'chatCreated'
	| 'participants'
	| 'messageEdited'
	| 'messageRemoved'
	| 'chatUpdated'
	| 'other';

const METHOD_TO_EVENT: Record<string, TriggerEvent> = {
	sendMessage: 'message',
	command: 'command',
	createP2PChat: 'chatCreated',
	createGroupChat: 'chatCreated',
	createChannel: 'chatCreated',
	createFavoritesChat: 'chatCreated',
	addChatParticipant: 'participants',
	removeChatParticipant: 'participants',
	changeParticipantRole: 'participants',
	editMessage: 'messageEdited',
	removeMessage: 'messageRemoved',
	editChatTitle: 'chatUpdated',
	editChatAvatar: 'chatUpdated',
	clearHistory: 'chatUpdated',
	removeChat: 'chatUpdated',
};

export class TrueConfTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TrueConf Trigger',
		name: 'trueConfTrigger',
		icon: 'file:trueconf.svg',
		group: ['trigger'],
		version: [1],
		description: 'Starts a workflow when a TrueConf bot receives a message or another event',
		defaults: {
			name: 'TrueConf Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'trueConfApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{
						name: 'Message Received',
						value: 'message',
						description: 'A user sent a message to the bot or to a chat the bot is in',
					},
					{
						name: 'Inline Button Pressed',
						value: 'command',
						description: 'A user pressed an inline keyboard button (TrueConf 5.5.6+)',
					},
					{
						name: 'Chat Created',
						value: 'chatCreated',
						description: 'The bot was added to a new personal chat, group chat or channel',
					},
					{
						name: 'Chat Updated',
						value: 'chatUpdated',
						description: 'Chat title or avatar changed, history cleared, chat removed',
					},
					{
						name: 'Message Edited',
						value: 'messageEdited',
						description: 'A message was edited',
					},
					{
						name: 'Message Removed',
						value: 'messageRemoved',
						description: 'A message was deleted',
					},
					{
						name: 'Participants Changed',
						value: 'participants',
						description: 'A participant was added, removed or got another role',
					},
					{
						name: 'Other Events',
						value: 'other',
						description: 'Any event not listed above (for example file upload progress)',
					},
				],
				default: ['message'],
				required: true,
				description: 'Which events should start the workflow',
			},
			{
				displayName: 'Chat Filter',
				name: 'chatIds',
				type: 'string',
				default: '',
				placeholder: 'a1b2c3d4e5f6…, 99887766…',
				description:
					'Optional. Comma- or newline-separated list of chat IDs. Only events from these chats start the workflow.',
			},
			{
				displayName: 'Ignore Messages From the Bot Itself',
				name: 'ignoreOwnMessages',
				type: 'boolean',
				default: true,
				description:
					'Whether to skip messages the bot sent itself. Disable to also trigger on the bot\'s own messages.',
			},
			{
				displayName: 'Include System Messages',
				name: 'includeSystemMessages',
				type: 'boolean',
				default: false,
				description:
					'Whether to deliver service messages (participants added/removed, title changes) as "Message Received" events',
			},
			{
				displayName: 'Deliver Messages Received While Offline',
				name: 'receiveUnread',
				type: 'boolean',
				default: false,
				description:
					'Whether TrueConf should send messages that arrived while the workflow was inactive. Up to 1000 messages, oldest first.',
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const credentials = (await this.getCredentials('trueConfApi')) as unknown as TrueConfCredentials;
		const events = (this.getNodeParameter('events', []) as string[]) ?? [];
		const chatFilter = String(this.getNodeParameter('chatIds', '') ?? '')
			.split(/[\s,;]+/)
			.map((value) => value.trim())
			.filter(Boolean);
		const ignoreOwnMessages = this.getNodeParameter('ignoreOwnMessages', true) as boolean;
		const includeSystemMessages = this.getNodeParameter('includeSystemMessages', false) as boolean;
		const receiveUnread = this.getNodeParameter('receiveUnread', false) as boolean;

		const client = new BridgeClient(
			credentials,
			(options) => this.helpers.httpRequest(options),
			{ receiveUnread, receiveSystemMessageEnvelopes: includeSystemMessages },
		);

		let resolveFirstEvent: (() => void) | undefined;
		const firstEvent = new Promise<void>((resolve) => {
			resolveFirstEvent = resolve;
		});

		const emitNotification = (notification: BridgeNotification): void => {
			const item = buildTriggerItem(notification, {
				events,
				chatFilter,
				ignoreOwnMessages,
				includeSystemMessages,
				botUserId: client.botUserId,
			});
			if (item) {
				this.emit([[item]]);
			}
		};

		const unsubscribe = client.onNotification((notification) => {
			emitNotification(notification);
			resolveFirstEvent?.();
		});

		try {
			await client.ensureConnected();
		} catch (error) {
			unsubscribe();
			await client.close();
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		const manualMode = this.getMode() === 'manual';

		return {
			closeFunction: async () => {
				unsubscribe();
				await client.close();
			},
			manualTriggerFunction: manualMode
				? async () => {
						// Wait for the first matching event so that "Test step" shows real data.
						await Promise.race([
							firstEvent,
							new Promise<void>((resolve) => {
								const timer = setTimeout(resolve, 120_000);
								timer.unref?.();
							}),
						]);
					}
				: undefined,
		};
	}
}

interface FilterOptions {
	events: string[];
	chatFilter: string[];
	ignoreOwnMessages: boolean;
	includeSystemMessages: boolean;
	botUserId?: string;
}

/**
 * Turns a server notification into one workflow item, or `undefined` when the current
 * filter settings exclude it.
 */
function buildTriggerItem(
	notification: BridgeNotification,
	options: FilterOptions,
): INodeExecutionData | undefined {
	const payload = (notification.payload ?? {}) as IDataObject;
	const event = METHOD_TO_EVENT[notification.method] ?? 'other';

	if (!options.events.includes(event)) {
		return undefined;
	}

	const chat = (payload.chat ?? {}) as IDataObject;
	const chatId = (chat.chatId ?? payload.chatId ?? '') as string;

	if (options.chatFilter.length > 0 && chatId && !options.chatFilter.includes(chatId)) {
		return undefined;
	}

	if (notification.method === 'sendMessage') {
		const author = (payload.author ?? {}) as IDataObject;
		const isSystemMessage = typeof payload.type === 'number' && (payload.type as number) < 200;

		if (isSystemMessage && !options.includeSystemMessages) {
			return undefined;
		}

		if (
			options.ignoreOwnMessages &&
			options.botUserId &&
			bareTrueConfId(author.id as string) === bareTrueConfId(options.botUserId)
		) {
			return undefined;
		}

		return {
			json: {
				...formatEnvelope(payload),
				event,
				method: notification.method,
			},
		};
	}

	return {
		json: {
			event,
			method: notification.method,
			chatId,
			chatTitle: chat.chatTitle ?? null,
			chatType: chat.chatType,
			raw: payload,
		},
	};
}
