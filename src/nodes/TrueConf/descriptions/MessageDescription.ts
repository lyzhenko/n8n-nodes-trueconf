import type { INodeProperties } from 'n8n-workflow';

const resource = ['message'] as const;

export const messageDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [...resource] } },
		options: [
			{
				name: 'Send Message',
				value: 'sendMessage',
				description: 'Send a text message to a chat',
				action: 'Send a message',
			},
			{
				name: 'Send File',
				value: 'sendFile',
				description: 'Upload a binary file and send it to a chat',
				action: 'Send a file',
			},
			{
				name: 'Edit Message',
				value: 'editMessage',
				description: 'Change the text of a message sent by the bot',
				action: 'Edit a message',
			},
			{
				name: 'Delete Message',
				value: 'deleteMessage',
				description: 'Remove a message sent by the bot',
				action: 'Delete a message',
			},
			{
				name: 'Forward Message',
				value: 'forwardMessage',
				description: 'Forward a message to another chat',
				action: 'Forward a message',
			},
			{
				name: 'Get Message',
				value: 'getMessage',
				description: 'Get a single message by its ID',
				action: 'Get a message',
			},
			{
				name: 'Get Chat History',
				value: 'getHistory',
				description: 'Get the latest messages of a chat, newest first',
				action: 'Get chat history',
			},
		],
		default: 'sendMessage',
	},
	{
		displayName: 'Chat ID or TrueConf ID',
		name: 'chatId',
		type: 'string',
		displayOptions: {
			show: {
				resource: [...resource],
				operation: ['sendMessage', 'sendFile', 'forwardMessage', 'getHistory'],
			},
		},
		default: '',
		required: true,
		placeholder: 'a1b2c3d4e5f6… or bot@video.example.com',
		description:
			'ID of the target chat. A TrueConf ID (user@server) creates or reuses a personal chat with that user.',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		displayOptions: {
			show: { resource: [...resource], operation: ['sendMessage', 'editMessage'] },
		},
		default: '',
		required: true,
		description: 'Message text. Formatting depends on the selected parse mode.',
	},
	{
		displayName: 'Parse Mode',
		name: 'parseMode',
		type: 'options',
		displayOptions: {
			show: { resource: [...resource], operation: ['sendMessage', 'editMessage'] },
		},
		options: [
			{ name: 'Plain Text', value: 'text' },
			{ name: 'Markdown', value: 'markdown' },
			{ name: 'HTML', value: 'html' },
		],
		default: 'text',
		description: 'How the message text should be interpreted by TrueConf',
	},
	{
		displayName: 'Reply to Message ID',
		name: 'replyToMessageId',
		type: 'string',
		displayOptions: {
			show: { resource: [...resource], operation: ['sendMessage', 'sendFile'] },
		},
		default: '',
		description: 'Optional. ID of the message this one replies to.',
	},
	{
		displayName: 'Binary Property',
		name: 'binaryPropertyName',
		type: 'string',
		displayOptions: { show: { resource: [...resource], operation: ['sendFile'] } },
		default: 'data',
		required: true,
		description: 'Name of the input binary field that contains the file to send',
	},
	{
		displayName: 'Caption',
		name: 'caption',
		type: 'string',
		typeOptions: { rows: 2 },
		displayOptions: { show: { resource: [...resource], operation: ['sendFile'] } },
		default: '',
		description: 'Optional text attached to the file',
	},
	{
		displayName: 'Caption Parse Mode',
		name: 'captionParseMode',
		type: 'options',
		displayOptions: { show: { resource: [...resource], operation: ['sendFile'] } },
		options: [
			{ name: 'Plain Text', value: 'text' },
			{ name: 'Markdown', value: 'markdown' },
			{ name: 'HTML', value: 'html' },
		],
		default: 'text',
		description: 'How the caption should be interpreted by TrueConf',
	},
	{
		displayName: 'Message ID',
		name: 'messageId',
		type: 'string',
		displayOptions: {
			show: {
				resource: [...resource],
				operation: ['editMessage', 'deleteMessage', 'forwardMessage', 'getMessage'],
			},
		},
		default: '',
		required: true,
		description: 'ID of the message to act on',
	},
	{
		displayName: 'Delete for Everyone',
		name: 'forAll',
		type: 'boolean',
		displayOptions: { show: { resource: [...resource], operation: ['deleteMessage'] } },
		default: true,
		description: 'Whether to delete the message for all chat participants, not only for the bot',
	},
	{
		displayName: 'Count',
		name: 'count',
		type: 'number',
		displayOptions: { show: { resource: [...resource], operation: ['getHistory'] } },
		default: 20,
		typeOptions: { minValue: 1, maxValue: 1000 },
		description: 'How many messages to return',
	},
	{
		displayName: 'From Message ID',
		name: 'fromMessageId',
		type: 'string',
		displayOptions: { show: { resource: [...resource], operation: ['getHistory'] } },
		default: '',
		description: 'Optional. Start history from this message ID (the message itself is included).',
	},
];
