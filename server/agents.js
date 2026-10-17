// Agent definitions + runs, persisted as JSON in ./data. A run executes either
// through the Claude Code CLI (your Claude subscription) or the Claude API (API key).
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveClaudeBin } from './claudeCli.js';
import { addUsage, costOf, emptyUsage, normalizeUsage } from './pricing.js';

// The desktop app points this at its per-user data folder.
const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

// Models that accept server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
// Models that support the dynamic-filtering web tool variants.
const NEW_WEB_TOOLS = /claude-(opus-(5|4-[678])|sonnet-(5|4-6))/;
const MAX_CONTINUATIONS = 10;

const SEED_AGENTS = [
  {
    name: 'Researcher',
    description: 'Searches the web and writes a sourced summary.',
    model: 'claude-opus-5-5',
    effort: 'high',
    webSearch: true,
    webFetch: true,
    systemPrompt:
      'You are a research assistant. Use web search to find current, reliable sources, then answer with a concise summary followed by a list of the sources you used.',
  },
  {
    name: 'Code reviewer',
    description: 'Reviews pasted code for bugs and clarity.',
    model: 'claude-opus-5-5',
    effort: 'high',
    webSearch: false,
    webFetch: false,
    systemPrompt:
      'You review code the user pastes. Lead with real bugs (with the line and a concrete failing case), then smaller clarity issues. Skip praise and style nits.',
  },
  {
    name: 'Quick helper',
    description: 'Fast, short answers for everyday questions.',
    model: 'claude-haiku-5-5',
    effort: 'low',
    webSearch: false,
    webFetch: false,
    systemPrompt: 'Answer briefly and directly.',
  },
];

let agents = [];
let runs = [];
const live = new Map(); // runId -> { abort, emitter }
// Emits 'run-finished' (run) when a run stops for any reason; the desktop app notifies on it.
export const runEvents = new EventEmitter();
let client = null;

function getClient() {
  // Zero-arg constructor resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
  client ??= new Anthropic();
  return client;
}

export function credentialHint() {
  if (process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY';
  if (process.env.ANTHROPIC_AUTH_TOKEN) return 'ANTHROPIC_AUTH_TOKEN';
  return null;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

export async function loadStore() {
  agents = await readJson(AGENTS_FILE, null);
  if (!agents) {
    const now = new Date().toISOString();
    agents = SEED_AGENTS.map((a) => ({ id: randomUUID(), createdAt: now, updatedAt: now, ...cleanAgent(a) }));
    await writeJson(AGENTS_FILE, agents);
  }
  agents = agents.map((a) => ({ ...a, ...cleanAgent(a) }));
  runs = await readJson(RUNS_FILE, []);
  // Anything left "running" from a previous server process was interrupted.
  for (const r of runs) if (r.status === 'running') r.status = 'stopped';
}

const saveAgents = () => writeJson(AGENTS_FILE, agents);
const saveRuns = () => writeJson(RUNS_FILE, runs);

// ---- Agents CRUD ----

export const listAgents = () => agents;
export const getAgent = (id) => agents.find((a) => a.id === id);

function cleanAgent(input) {
  const effort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(input.effort) ? input.effort : 'high';
  return {
    name: String(input.name || 'Untitled agent').slice(0, 80),
    description: String(input.description || '').slice(0, 300),
    // 'cli' runs through Claude Code on your subscription; 'api' uses an API key.
    runner: input.runner === 'api' ? 'api' : 'cli',
    model: String(input.model || 'claude-opus-5-5'),
    effort,
    systemPrompt: String(input.systemPrompt || ''),
    webSearch: !!input.webSearch,
    webFetch: !!input.webFetch,
    // CLI only: what the agent may do on disk, and where.
    fileAccess: ['none', 'read', 'edit'].includes(input.fileAccess) ? input.fileAccess : 'none',
    allowCommands: !!input.allowCommands,
    workDir: String(input.workDir || '').trim(),
    maxTokens: Math.min(Math.max(Number(input.maxTokens) || 64000, 1024), 128000),
  };
}

export async function createAgent(input) {
  const now = new Date().toISOString();
  const a = { id: randomUUID(), createdAt: now, updatedAt: now, ...cleanAgent(input) };
  agents.push(a);
  await saveAgents();
  return a;
}

export async function updateAgent(id, input) {
  const a = getAgent(id);
  if (!a) return null;
  Object.assign(a, cleanAgent({ ...a, ...input }), { updatedAt: new Date().toISOString() });
  await saveAgents();
  return a;
}

export async function deleteAgent(id) {
  const before = agents.length;
  agents = agents.filter((a) => a.id !== id);
  if (agents.length !== before) await saveAgents();
  return agents.length !== before;
}

// ---- Runs ----

export const listRuns = () =>
  runs
    .map(({ messages, live: _l, ...rest }) => ({
      ...rest,
      preview: firstUserText(messages),
      turns: messages.filter((m) => m.role === 'user' && typeof m.content === 'string').length,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const getRun = (id) => runs.find((r) => r.id === id);

export async function deleteRun(id) {
  live.get(id)?.abort();
  const before = runs.length;
  runs = runs.filter((r) => r.id !== id);
  if (runs.length !== before) await saveRuns();
  return runs.length !== before;
}

function firstUserText(messages) {
  const m = messages.find((x) => x.role === 'user');
  if (!m) return '';
  const t = typeof m.content === 'string' ? m.content : m.content.map((b) => b.text || '').join(' ');
  return t.slice(0, 200);
}

export function subscribe(runId, fn) {
  const l = live.get(runId);
  if (!l) return () => {};
  l.emitter.on('update', fn);
  return () => l.emitter.off('update', fn);
}

export function stopRun(id) {
  const l = live.get(id);
  if (!l) return false;
  l.abort();
  return true;
}

export async function startRun(agentId, prompt) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error('Agent not found');
  const now = new Date().toISOString();
  const run = {
    id: randomUUID(),
    agentId: agent.id,
    agentName: agent.name,
    // Snapshot the config so later edits to the agent don't change this run.
    config: { ...agent },
    runner: agent.runner,
    model: agent.model,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    messages: [{ role: 'user', content: prompt }],
    usage: emptyUsage(),
    cost: 0,
    apiCalls: 0,
    error: null,
    stopReason: null,
    cliSessionId: null,
    live: null,
  };
  runs.push(run);
  await saveRuns();
  execute(run);
  return run;
}

// Add a follow-up prompt, or with no prompt retry a run whose last turn failed.
export async function continueRun(id, prompt) {
  const run = getRun(id);
  if (!run) throw new Error('Run not found');
  if (live.has(id)) throw new Error('Run is still in progress');
  if (prompt) run.messages.push({ role: 'user', content: prompt });
  else if (run.messages.at(-1)?.role !== 'user') throw new Error('Nothing to retry');
  run.status = 'running';
  run.error = null;
  run.updatedAt = new Date().toISOString();
  await saveRuns();
  execute(run);
  return run;
}

// Apply one raw Messages API stream event to the in-progress assistant message.
function applyStreamEvent(run, ev, partialJson) {
  if (ev.type === 'message_start') {
    run.live = { id: ev.message?.id, content: [] };
    return;
  }
  run.live ??= { id: null, content: [] };
  const blocks = run.live.content;
  if (ev.type === 'content_block_start') {
    blocks[ev.index] = structuredClone(ev.content_block);
    delete partialJson[ev.index];
  } else if (ev.type === 'content_block_delta') {
    const b = blocks[ev.index];
    if (!b) return;
    if (ev.delta.type === 'text_delta') b.text = (b.text || '') + ev.delta.text;
    else if (ev.delta.type === 'thinking_delta') b.thinking = (b.thinking || '') + ev.delta.thinking;
    else if (ev.delta.type === 'input_json_delta') {
      partialJson[ev.index] = (partialJson[ev.index] || '') + ev.delta.partial_json;
      try {
        b.input = JSON.parse(partialJson[ev.index]);
      } catch {
        /* incomplete JSON while streaming */
      }
    }
  }
}

async function execute(run) {
  const emitter = new EventEmitter();
  const ctl = { aborted: false, onAbort: null };
  live.set(run.id, {
    emitter,
    abort: () => {
      ctl.aborted = true;
      ctl.onAbort?.();
    },
  });

  // Throttled push of the in-progress state to SSE subscribers.
  let pending = null;
  const push = (immediate = false) => {
    if (immediate) {
      clearTimeout(pending);
      pending = null;
      emitter.emit('update', run);
      return;
    }
    pending ??= setTimeout(() => {
      pending = null;
      emitter.emit('update', run);
    }, 120);
  };

  try {
    if ((run.config.runner || 'api') === 'cli') await runCli(run, ctl, push);
    else await runApi(run, ctl, push);
    if (ctl.aborted) run.status = 'stopped';
    else run.status = run.stopReason === 'refusal' ? 'refused' : 'completed';
  } catch (err) {
    if (ctl.aborted || err instanceof Anthropic.APIUserAbortError) {
      run.status = 'stopped';
    } else {
      run.status = 'error';
      run.error = describeError(err);
    }
  } finally {
    run.live = null;
    run.updatedAt = new Date().toISOString();
    live.delete(run.id);
    await saveRuns().catch(() => {});
    clearTimeout(pending);
    emitter.emit('update', run);
    emitter.emit('done');
    runEvents.emit('run-finished', run);
  }
}

// ---- Claude API runner ----

function buildParams(cfg, messages) {
  const tools = [];
  const newWeb = NEW_WEB_TOOLS.test(cfg.model);
  if (cfg.webSearch) tools.push({ type: newWeb ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 8 });
  if (cfg.webFetch) tools.push({ type: newWeb ? 'web_fetch_20260209' : 'web_fetch_20250910', name: 'web_fetch', max_uses: 8 });
  const params = {
    model: cfg.model,
    max_tokens: cfg.maxTokens || 64000,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: cfg.effort || 'high' },
    messages,
  };
  if (cfg.systemPrompt) params.system = cfg.systemPrompt;
  if (tools.length) params.tools = tools;
  if (FALLBACK_MODELS.has(cfg.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

async function runApi(run, ctl, push) {
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const stream = getClient().beta.messages.stream(buildParams(run.config, run.messages));
    ctl.onAbort = () => stream.abort();
    if (ctl.aborted) stream.abort();
    run.live = { id: null, content: [] };
    const partialJson = {};
    for await (const ev of stream) {
      applyStreamEvent(run, ev, partialJson);
      push();
    }

    const msg = await stream.finalMessage();
    run.apiCalls++;
    const u = normalizeUsage(msg.usage);
    addUsage(run.usage, u);
    run.cost += costOf(msg.model, u);
    run.model = msg.model;
    run.stopReason = msg.stop_reason;
    // Append the full content (thinking + tool blocks included) so the history stays append-only.
    run.messages.push({ role: 'assistant', content: msg.content });
    run.live = null;
    run.updatedAt = new Date().toISOString();
    push(true);
    if (msg.stop_reason !== 'pause_turn') break;
  }
}

// ---- Claude Code CLI runner ----

// Built-in Claude Code tools this agent may use; all are pre-approved, and
// anything else that would need a permission prompt is denied.
function cliTools(cfg) {
  const tools = [];
  if (cfg.webSearch) tools.push('WebSearch');
  if (cfg.webFetch) tools.push('WebFetch');
  if (cfg.fileAccess === 'read' || cfg.fileAccess === 'edit') tools.push('Read', 'Grep', 'Glob');
  if (cfg.fileAccess === 'edit') tools.push('Edit', 'Write');
  if (cfg.allowCommands) tools.push(process.platform === 'win32' ? 'PowerShell' : 'Bash');
  return tools;
}

async function agentWorkDir(cfg) {
  const dir = cfg.workDir || path.join(WORKSPACES_DIR, cfg.id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function runCli(run, ctl, push) {
  const bin = resolveClaudeBin();
  if (!bin) throw new Error('CLI_NOT_FOUND');
  const cfg = run.config;
  // The newest typed prompt (tool results are also stored as user messages).
  const prompt = run.messages.findLast((m) => m.role === 'user' && typeof m.content === 'string').content;
  const tools = cliTools(cfg);
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', cfg.model,
    '--effort', cfg.effort || 'high',
    '--permission-prompts', 'none',
    '--tools', tools.length ? tools.join(',') : '',
  ];
  if (tools.length) args.push('--allowedTools', tools.join(','));
  if (cfg.systemPrompt) args.push('--append-system-prompt', cfg.systemPrompt);
  if (run.cliSessionId) args.push('--resume', run.cliSessionId);
  else args.push('--name', `Alfred: ${cfg.name}`);

  // Follow-ups resume in the folder the run started in; Claude Code finds sessions by folder.
  const cwd = run.cwd && fsSync.existsSync(run.cwd) ? run.cwd : await agentWorkDir(cfg);
  run.cwd = cwd;
  // Drop API credentials from the child env so the CLI uses your Claude subscription login.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const child = spawn(bin, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  ctl.onAbort = () => child.kill();
  if (ctl.aborted) child.kill();
  // The prompt goes over stdin, which avoids command-line quoting and length limits.
  child.stdin.end(prompt);

  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  let result = null;
  let buf = '';
  const partialJson = {};

  const handle = (o) => {
    if (o.type === 'system' && o.subtype === 'init') {
      run.cliSessionId = o.session_id || run.cliSessionId;
      if (o.model) run.model = o.model;
    } else if (o.type === 'stream_event' && !o.parent_tool_use_id) {
      applyStreamEvent(run, o.event, partialJson);
    } else if (o.type === 'assistant' && o.message && !o.parent_tool_use_id && o.message.model !== '<synthetic>') {
      // (Synthetic messages are CLI notices like "Not logged in"; the result event reports them.)
      // The CLI may emit one line per content block of the same API message; merge them.
      const last = run.messages.at(-1);
      if (last?.role === 'assistant' && last.id && last.id === o.message.id) {
        last.content.push(...o.message.content);
      } else {
        run.messages.push({ role: 'assistant', id: o.message.id, content: [...o.message.content] });
        run.apiCalls++;
      }
      if (o.message.model) run.model = o.message.model;
      if (run.live?.id === o.message.id) run.live = null;
    } else if (o.type === 'user' && Array.isArray(o.message?.content) && !o.parent_tool_use_id) {
      const results = o.message.content.filter((b) => b.type === 'tool_result');
      if (results.length) run.messages.push({ role: 'user', content: results });
    } else if (o.type === 'result') {
      result = o;
    }
    push();
  };

  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch {
        /* non-JSON noise */
      }
    }
  });

  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  run.live = null;
  if (ctl.aborted) return;

  if (result) {
    run.cliSessionId = result.session_id || run.cliSessionId;
    // On a subscription this is Claude Code's notional API-price estimate, not a charge.
    if (typeof result.total_cost_usd === 'number') run.cost += result.total_cost_usd;
    if (result.usage) addUsage(run.usage, normalizeUsage(result.usage));
    run.stopReason = result.stop_reason || result.subtype;
    if (result.is_error) {
      const msg = typeof result.result === 'string' && result.result ? result.result : result.subtype;
      throw new Error(`CLI: ${msg}`);
    }
  } else if (code !== 0) {
    throw new Error(`CLI exited with code ${code}. ${stderr.trim().slice(-800)}`);
  }
}

function describeError(err) {
  const m = err?.message || String(err);
  if (m === 'CLI_NOT_FOUND') {
    return 'Claude Code CLI not found. Install it (see the banner on the Agents page) or set CLAUDE_BIN in .env.';
  }
  if (/not logged in|login|authenticat|\/login|invalid api key/i.test(m) && m.startsWith('CLI')) {
    return 'The Claude Code CLI is not signed in. Run `claude auth login` in a terminal, then retry.';
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Authentication failed. Add ANTHROPIC_API_KEY to the .env file in the project folder and restart the server.';
  }
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.';
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ''}: ${err.message}`;
  if (m.includes('Could not resolve authentication')) {
    return 'No API credentials found. Add ANTHROPIC_API_KEY to the .env file, or switch this agent to the Claude subscription runner.';
  }
  return m;
}
