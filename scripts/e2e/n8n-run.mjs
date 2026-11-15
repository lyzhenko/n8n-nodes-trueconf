/**
 * Runs a workflow manually through the n8n REST API and prints the result.
 *
 * Usage on the n8n host: node n8n-run.mjs <workflowId> [triggerNodeName] [nodeName]
 *
 * Manual runs are started with POST /rest/workflows/:id/run
 * ({triggerToStartFrom:{name}}) and polled through GET /rest/executions/:id.
 */
import { readFileSync } from 'node:fs';

const [workflowId, triggerName = 'When clicking Execute', nodeName = 'TrueConf'] = process.argv.slice(2);
if (!workflowId) {
	throw new Error('workflowId is required');
}

const config = JSON.parse(readFileSync('/tmp/tc-e2e/config.json', 'utf8'));
const BASE = 'http://127.0.0.1:5678';
let cookie = '';

async function api(path, { method = 'GET', body } = {}) {
	const headers = { 'content-type': 'application/json' };
	if (cookie) {
		headers.cookie = cookie;
	}
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const setCookies = response.headers.getSetCookie?.() ?? [];
	if (setCookies.length > 0) {
		cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
	}
	const text = await response.text();
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		payload = text;
	}
	if (!response.ok) {
		throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 800)}`);
	}
	return payload.data ?? payload;
}

await api('/rest/login', {
	method: 'POST',
	body: { emailOrLdapLoginId: config.email, password: config.password },
});

const started = await api(`/rest/workflows/${workflowId}/run`, {
	method: 'POST',
	body: { triggerToStartFrom: { name: triggerName } },
});

const executionId = started.executionId ?? started.execution?.id;
if (!executionId) {
	process.stdout.write(`unexpected run response: ${JSON.stringify(started)}\n`);
	process.exit(1);
}

let execution;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
	execution = await api(`/rest/executions/${executionId}?includeData=true`);
	if (execution.status !== 'running' && execution.status !== 'new' && execution.status !== 'waiting') {
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, 400));
}

const runData = execution.data?.resultData?.runData ?? {};
const nodeRun = runData[nodeName]?.[0];

process.stdout.write(
	JSON.stringify(
		{
			executionId,
			status: execution.status,
			startedAt: execution.startedAt,
			stoppedAt: execution.stoppedAt,
			error: execution.data?.resultData?.error
				? {
						message: execution.data.resultData.error.message,
						node: execution.data.resultData.error.node?.name,
						description: execution.data.resultData.error.description,
					}
				: undefined,
			output: nodeRun
				? {
						executionStatus: nodeRun.executionStatus,
						error: nodeRun.error
							? { message: nodeRun.error.message, description: nodeRun.error.description }
							: undefined,
						items: nodeRun.data?.main?.[0]?.map((item) => item.json),
					}
				: undefined,
		},
		null,
		2,
	) + '\n',
);
