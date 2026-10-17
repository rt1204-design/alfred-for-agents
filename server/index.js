import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as store from './agents.js';
import { cliStatus } from './claudeCli.js';
import { getSessionDetail, getSummary } from './claudeCode.js';
import { AGENT_MODELS } from './pricing.js';

const app = express();

// Only this computer's own pages may talk to the server. The server already
// listens on 127.0.0.1 only; these checks also stop web pages in a browser from
// reaching it (DNS rebinding, cross-site requests).
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hostnameOf = (hostHeader) => String(hostHeader || '').replace(/:\d+$/, '').toLowerCase();
const originHostname = (origin) => {
  try {
    return new URL(origin).hostname; // IPv6 comes back bracketed, e.g. "[::1]"
  } catch {
    return ''; // "null" or malformed
  }
};
app.use((req, res, next) => {
  // A rebinding attack arrives with the attacker's domain in the Host header.
  if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host))) return res.status(403).json({ error: 'Forbidden host' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Requests from another website carry that site's Origin ("null" from sandboxed pages).
    const origin = req.headers.origin;
    if (origin !== undefined && !LOCAL_HOSTS.has(originHostname(origin))) {
      return res.status(403).json({ error: 'Forbidden origin' });
    }
    // A custom header can't be sent cross-site without a CORS preflight, which this server never grants.
    if (req.headers['x-alfred'] !== '1') return res.status(403).json({ error: 'Missing X-Alfred header' });
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => res.status(500).json({ error: err.message }));

app.get('/api/health', wrap(async (req, res) => {
  const cli = await cliStatus({ force: req.query.refresh === '1' });
  res.json({ ok: true, credentials: store.credentialHint(), cli, models: AGENT_MODELS });
}));

// ---- Claude Code monitor ----
app.get('/api/claude-code/summary', wrap(async (req, res) => {
  res.json(await getSummary({ force: req.query.refresh === '1' }));
}));
app.get('/api/claude-code/sessions/:id', wrap(async (req, res) => {
  res.json(await getSessionDetail(req.params.id));
}));

// ---- Agents ----
app.get('/api/agents', (_req, res) => res.json(store.listAgents()));
app.post('/api/agents', wrap(async (req, res) => res.status(201).json(await store.createAgent(req.body))));
app.put('/api/agents/:id', wrap(async (req, res) => {
  const a = await store.updateAgent(req.params.id, req.body);
  a ? res.json(a) : res.status(404).json({ error: 'Not found' });
}));
app.delete('/api/agents/:id', wrap(async (req, res) => {
  (await store.deleteAgent(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
}));

// ---- Runs ----
app.get('/api/runs', (_req, res) => res.json(store.listRuns()));
app.post('/api/agents/:id/runs', wrap(async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
  const run = await store.startRun(req.params.id, prompt);
  res.status(201).json({ id: run.id });
}));
app.get('/api/runs/:id', (req, res) => {
  const r = store.getRun(req.params.id);
  r ? res.json(r) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/runs/:id/messages', wrap(async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
  await store.continueRun(req.params.id, prompt);
  res.json({ ok: true });
}));
app.post('/api/runs/:id/retry', wrap(async (req, res) => {
  await store.continueRun(req.params.id, null);
  res.json({ ok: true });
}));
app.post('/api/runs/:id/stop', (req, res) => res.json({ stopped: store.stopRun(req.params.id) }));
app.delete('/api/runs/:id', wrap(async (req, res) => {
  (await store.deleteRun(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
}));

// Live run updates over Server-Sent Events.
app.get('/api/runs/:id/events', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return res.status(404).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (r) => res.write(`data: ${JSON.stringify(r)}\n\n`);
  send(run);
  const unsubscribe = store.subscribe(run.id, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

// Starts the server and resolves with the port it is listening on. Used by
// `npm start` below and by the desktop app (electron/main.js), which passes
// port 0 for a free port and the location of the built UI.
export async function startServer({ port = Number(process.env.PORT) || 3001, distDir = path.resolve('dist') } = {}) {
  // Serve the built UI when it exists (`npm start` and the desktop app).
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }
  await store.loadStore();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

export const runEvents = store.runEvents;

// Run directly with `node server/index.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = await startServer();
  const url = `http://localhost:${port}`;
  console.log(`Alfred for Agents on ${url}`);
  // Set by the Start Dashboard launcher: open the UI once the server is up.
  if (process.env.OPEN_BROWSER) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  }
}
