async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  health: () => request('GET', '/api/health'),
  summary: (refresh) => request('GET', `/api/claude-code/summary${refresh ? '?refresh=1' : ''}`),
  session: (id) => request('GET', `/api/claude-code/sessions/${encodeURIComponent(id)}`),
  agents: () => request('GET', '/api/agents'),
  createAgent: (a) => request('POST', '/api/agents', a),
  updateAgent: (id, a) => request('PUT', `/api/agents/${id}`, a),
  deleteAgent: (id) => request('DELETE', `/api/agents/${id}`),
  runs: () => request('GET', '/api/runs'),
  run: (id) => request('GET', `/api/runs/${id}`),
  startRun: (agentId, prompt) => request('POST', `/api/agents/${agentId}/runs`, { prompt }),
  continueRun: (id, prompt) => request('POST', `/api/runs/${id}/messages`, { prompt }),
  retryRun: (id) => request('POST', `/api/runs/${id}/retry`),
  stopRun: (id) => request('POST', `/api/runs/${id}/stop`),
  deleteRun: (id) => request('DELETE', `/api/runs/${id}`),
};
