import type { INodeProperties } from 'n8n-workflow';

const resource = ['chat'] as const;

export const chatDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [...resource] } },
		options: [
			{
				name: 'Get Many',
				value: 'getChats',
				description: 'List chats the bot participates in',
				action: 'Get many chats',
			},
			{
				name: 'Get',
				value: 'getChat',
				description: 'Get a chat by its ID',
				action: 'Get a chat',
			},
			{
				name: 'Create Personal Chat',
				value: 'createP2PChat',
				description: 'Open (or reuse) a personal chat with a user',
				action: 'Create a personal chat',
			},
			{
				name: 'Create Group Chat',
				value: 'createGroupChat',
				description: 'Create a group chat owned by the bot',
				action: 'Create a group chat',
			},
			{
				name: 'Create Channel',
				value: 'createChannel',
				description: 'Create a channel where the bot posts messages',
				action: 'Create a channel',
			},
			{
				name: 'Get Participants',
				value: 'getParticipants',
				description: 'List participants of a chat',
				action: 'Get chat participants',
			},
		],
		default: 'getChats',
	},
	{
		displayName: 'Chat ID',
		name: 'chatId',
		type: 'string',
		displayOptions: {
			show: { resource: [...resource], operation: ['getChat', 'getParticipants'] },
		},
		default: '',
		required: true,
		placeholder: 'a1b2c3d4e5f6…',
		description: 'ID of the chat',
	},
	{
		displayName: 'TrueConf ID',
		name: 'userId',
		type: 'string',
		displayOptions: { show: { resource: [...resource], operation: ['createP2PChat'] } },
		default: '',
		required: true,
		placeholder: 'user@video.example.com',
		description: 'TrueConf ID of the user to open a personal chat with',
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		displayOptions: {
			show: { resource: [...resource], operation: ['createGroupChat', 'createChannel'] },
		},
		default: '',
		required: true,
		description: 'Name of the new group chat or channel',
	},
	{
		displayName: 'Count',
		name: 'count',
		type: 'number',
		displayOptions: { show: { resource: [...resource], operation: ['getChats'] } },
		default: 10,
		typeOptions: { minValue: 1, maxValue: 100 },
		description: 'How many chats to return',
	},
	{
		displayName: 'Page',
		name: 'page',
		type: 'number',
		displayOptions: { show: { resource: [...resource], operation: ['getChats'] } },
		default: 1,
		typeOptions: { minValue: 1 },
		description: 'Page number, starting from 1',
	},
];
