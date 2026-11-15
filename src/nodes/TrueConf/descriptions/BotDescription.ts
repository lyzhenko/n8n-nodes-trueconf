import type { INodeProperties } from 'n8n-workflow';

const resource = ['bot'] as const;

export const botDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [...resource] } },
		options: [
			{
				name: 'Get Bot Info',
				value: 'getBotInfo',
				description: 'Check the connection and get the TrueConf ID of the bot',
				action: 'Get bot info',
			},
		],
		default: 'getBotInfo',
	},
];
