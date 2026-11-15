/** A tiny IHttpRequestOptions-compatible transport for tests (no n8n runtime needed). */
export function makeHttpRequest() {
	const calls = [];

	const httpRequest = async (options) => {
		calls.push(options);
		const headers = { ...(options.headers ?? {}) };
		let body;

		if (Buffer.isBuffer(options.body)) {
			body = options.body;
		} else if (typeof options.body === 'string') {
			body = options.body;
		} else if (options.body instanceof URLSearchParams) {
			body = options.body.toString();
		} else if (options.body !== undefined) {
			body = JSON.stringify(options.body);
			headers['content-type'] ??= 'application/json';
		}

		const response = await fetch(options.url, {
			method: options.method ?? 'GET',
			headers,
			body,
		});

		const text = await response.text();
		let parsed;
		try {
			parsed = text ? JSON.parse(text) : undefined;
		} catch {
			parsed = text;
		}

		if (options.returnFullResponse) {
			return { statusCode: response.status, body: parsed, headers: response.headers };
		}

		if (!response.ok && !options.ignoreHttpStatusErrors) {
			const error = new Error(`Request failed with status code ${response.status}`);
			error.httpCode = response.status;
			error.response = { body: parsed, status: response.status };
			throw error;
		}

		return parsed;
	};

	httpRequest.calls = calls;
	return httpRequest;
}

export function flush(ms = 50) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate, timeoutMs = 5000, stepMs = 25) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) {
			return true;
		}
		await flush(stepMs);
	}
	return false;
}
