import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class TrueConfApi implements ICredentialType {
	name = 'trueConfApi';

	displayName = 'TrueConf API';

	icon = 'file:trueconf.png' as const;

	documentationUrl = 'https://trueconf.ru/docs/chatbot-connector/ru/connect-and-auth/';

	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://127.0.0.1:4309',
			required: true,
			placeholder: 'http://n8n.example.com:4309',
			description:
				'Address of the TrueConf Server that hosts the bot. Use the local TrueConf Bridge port (4309) ' +
				'or the public HTTPS address of the server. The scheme is optional and defaults to http.',
		},
		{
			displayName: 'Bot TrueConf ID',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'bot@video.example.com',
			description:
				'TrueConf ID (login) of the bot account. It must be a user of this TrueConf Server, not a guest.',
		},
		{
			displayName: 'Bot Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Password of the bot account. Password sign-in must be enabled on the server.',
		},
		{
			displayName: 'Ignore SSL Issues',
			name: 'ignoreSslIssues',
			type: 'boolean',
			default: false,
			description:
				'Whether to connect even if the server certificate cannot be verified (self-signed certificates). ' +
				'Only enable this for servers you trust.',
		},
	];

	// The password grant returns 201 Created with {access_token, token_type, expires_at}.
	// The expression keeps the test working when the user omitted the scheme or typed a
	// trailing slash (the node itself normalizes the URL the same way at runtime).
	test: ICredentialTestRequest = {
		request: {
			url: "={{ ((($credentials.baseUrl || '').trim().match(/^https?:\\/\\//i)) ? ($credentials.baseUrl || '').trim() : 'http://' + ($credentials.baseUrl || '').trim()).replace(/\\/+$/, '') + '/bridge/api/client/v1/oauth/token' }}",
			method: 'POST',
			body: {
				client_id: 'chat_bot',
				grant_type: 'password',
				username: '={{$credentials.username}}',
				password: '={{$credentials.password}}',
			},
			json: true,
			skipSslCertificateValidation: '={{$credentials.ignoreSslIssues}}',
		},
	};
}
