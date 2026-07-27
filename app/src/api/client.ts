// Shared fetch wrapper — replaces the old app's post/tpost helper that was
// independently reimplemented ~5 times across components with slightly
// different header casing.
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	})
	if (!res.ok) {
		let message = `${method} ${url} failed: ${res.status}`
		try {
			const data = await res.json()
			if (data && data.error) message = data.error
		} catch {
			/* ignore parse failure, use default message */
		}
		throw new Error(message)
	}
	return res.json() as Promise<T>
}

export const api = {
	get: <T>(url: string) => request<T>('GET', url),
	post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
	patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
	delete: <T>(url: string) => request<T>('DELETE', url),
}
