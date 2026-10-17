// Reads Claude Code session transcripts (~/.claude/projects/**/*.jsonl) and
// aggregates them into per-session and per-day stats.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addUsage, costOf, emptyUsage, normalizeUsage, totalTokens } from './pricing.js';

export const PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');

// Parsed-file cache keyed by path; reused while mtime and size are unchanged.
const fileCache = new Map();

async function listJsonl(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJsonl(p)));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function localDay(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function textOf(content) {
  let t;
  if (typeof content === 'string') t = content;
  else if (Array.isArray(content)) {
    t = content
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  } else return '';
  // Drop harness-injected context so only what the person typed remains.
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function isHumanPrompt(o) {
  if (o.type !== 'user' || o.isMeta || !o.message) return false;
  const c = o.message.content;
  if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) return false;
  const t = textOf(c).trim();
  if (!t || t.startsWith('<command-') || t.startsWith('<local-command')) return false;
  if (o.origin && o.origin.kind && o.origin.kind !== 'human') return false;
  return true;
}

function summarizeToolInput(name, input = {}) {
  const v =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ??
    input.query ?? input.description ?? input.prompt ?? input.skill;
  if (typeof v === 'string') return v.length > 160 ? v.slice(0, 157) + '…' : v;
  return '';
}

// Parse one transcript file into partial per-session records.
async function parseFile(file) {
  const raw = await fs.readFile(file, 'utf8');
  const sessions = new Map();
  const get = (id) => {
    if (!sessions.has(id)) {
      sessions.set(id, {
        id,
        cwd: null,
        project: path.basename(path.dirname(file)),
        gitBranch: null,
        entrypoint: null,
        version: null,
        title: null,
        firstPrompt: null,
        start: null,
        end: null,
        prompts: 0,
        assistantMessages: 0,
        tools: {},
        models: {},
        usage: emptyUsage(),
        cost: 0,
        daily: {},
        msgUsage: new Map(), // message.id -> { model, usage, day }
        files: new Set(),
      });
    }
    return sessions.get(id);
  };

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const sid = o.sessionId;
    if (!sid) continue;
    const s = get(sid);
    s.files.add(file);
    if (o.type === 'custom-title' || o.type === 'ai-title' || o.type === 'summary') {
      s.title = o.customTitle || o.aiTitle || o.title || o.summary || s.title;
    }
    if (o.cwd && !s.cwd) s.cwd = o.cwd;
    if (o.gitBranch && !s.gitBranch) s.gitBranch = o.gitBranch;
    if (o.entrypoint && !s.entrypoint) s.entrypoint = o.entrypoint;
    if (o.version) s.version = o.version;
    const ts = o.timestamp;
    if (ts && (o.type === 'user' || o.type === 'assistant')) {
      if (!s.start || ts < s.start) s.start = ts;
      if (!s.end || ts > s.end) s.end = ts;
    }
    const day = ts ? localDay(ts) : null;

    if (isHumanPrompt(o) && !o.isSidechain) {
      s.prompts++;
      if (!s.firstPrompt) s.firstPrompt = textOf(o.message.content).trim().slice(0, 300);
      if (day) {
        const d = (s.daily[day] ??= { prompts: 0, tools: {} });
        d.prompts++;
      }
    }

    if (o.type === 'assistant' && o.message) {
      const m = o.message;
      if (m.model === '<synthetic>') continue;
      // A single API message is logged as one line per content block, each
      // repeating the same usage; keep one usage per message id.
      if (m.id && m.usage) {
        s.msgUsage.set(m.id, { model: m.model, usage: normalizeUsage(m.usage), day });
      }
      for (const b of m.content || []) {
        if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
          s.tools[b.name] = (s.tools[b.name] || 0) + 1;
          if (day) {
            const d = (s.daily[day] ??= { prompts: 0, tools: {} });
            d.tools[b.name] = (d.tools[b.name] || 0) + 1;
          }
        }
      }
    }
  }
  return sessions;
}

async function parseCached(file) {
  const st = await fs.stat(file);
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.sessions;
  const sessions = await parseFile(file);
  fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, sessions });
  return sessions;
}

function mergeInto(target, src) {
  for (const k of ['cwd', 'gitBranch', 'entrypoint', 'title', 'firstPrompt']) {
    if (!target[k] && src[k]) target[k] = src[k];
  }
  if (src.version) target.version = src.version;
  if (src.start && (!target.start || src.start < target.start)) target.start = src.start;
  if (src.end && (!target.end || src.end > target.end)) target.end = src.end;
  target.prompts += src.prompts;
  for (const [n, c] of Object.entries(src.tools)) target.tools[n] = (target.tools[n] || 0) + c;
  for (const [day, d] of Object.entries(src.daily)) {
    const t = (target.daily[day] ??= { prompts: 0, tools: {} });
    t.prompts += d.prompts;
    for (const [n, c] of Object.entries(d.tools)) t.tools[n] = (t.tools[n] || 0) + c;
  }
  for (const [id, mu] of src.msgUsage) target.msgUsage.set(id, mu);
  for (const f of src.files) target.files.add(f);
}

let lastSummary = null;
let lastSummaryAt = 0;

export async function getSummary({ force = false } = {}) {
  if (!force && lastSummary && Date.now() - lastSummaryAt < 5000) return lastSummary;
  const files = await listJsonl(PROJECTS_DIR);
  const merged = new Map();
  for (const f of files) {
    let parsed;
    try {
      parsed = await parseCached(f);
    } catch {
      continue;
    }
    for (const [id, s] of parsed) {
      if (!merged.has(id)) {
        merged.set(id, {
          ...s,
          tools: {},
          daily: {},
          prompts: 0,
          msgUsage: new Map(),
          files: new Set(),
          usage: emptyUsage(),
        });
      }
      mergeInto(merged.get(id), s);
    }
  }

  const daily = {};
  const sessions = [];
  for (const s of merged.values()) {
    if (!s.start) continue; // no real messages
    const usage = emptyUsage();
    let cost = 0;
    const models = {};
    for (const { model, usage: u, day } of s.msgUsage.values()) {
      addUsage(usage, u);
      const c = costOf(model, u);
      cost += c;
      models[model] = (models[model] || 0) + 1;
      if (day) {
        const d = (daily[day] ??= blankDay(day));
        addUsage(d.usage, u);
        d.cost += c;
        d.messages++;
      }
    }
    for (const [day, d] of Object.entries(s.daily)) {
      const t = (daily[day] ??= blankDay(day));
      t.prompts += d.prompts;
      for (const [n, c] of Object.entries(d.tools)) t.tools[n] = (t.tools[n] || 0) + c;
    }
    const startDay = localDay(s.start);
    if (startDay) (daily[startDay] ??= blankDay(startDay)).sessions++;

    sessions.push({
      id: s.id,
      title: s.title,
      firstPrompt: s.firstPrompt,
      cwd: s.cwd,
      project: s.cwd ? path.basename(s.cwd) : s.project,
      gitBranch: s.gitBranch,
      entrypoint: s.entrypoint,
      version: s.version,
      start: s.start,
      end: s.end,
      prompts: s.prompts,
      apiCalls: s.msgUsage.size,
      tools: s.tools,
      toolCalls: Object.values(s.tools).reduce((a, b) => a + b, 0),
      models,
      usage,
      totalTokens: totalTokens(usage),
      cost,
    });
  }
  sessions.sort((a, b) => (b.end || '').localeCompare(a.end || ''));
  const days = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) d.totalTokens = totalTokens(d.usage);

  lastSummary = { projectsDir: PROJECTS_DIR, generatedAt: new Date().toISOString(), sessions, daily: days };
  lastSummaryAt = Date.now();
  return lastSummary;
}

function blankDay(date) {
  return { date, usage: emptyUsage(), cost: 0, messages: 0, prompts: 0, sessions: 0, tools: {} };
}

// Full timeline for one session: prompts, assistant text and tool calls.
export async function getSessionDetail(id) {
  const files = await listJsonl(PROJECTS_DIR);
  const candidates = files.filter((f) => f.includes(id));
  const scan = candidates.length ? candidates : files;
  const events = [];
  for (const f of scan) {
    const raw = await fs.readFile(f, 'utf8');
    if (!raw.includes(id)) continue;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.sessionId !== id) continue;
      const base = { ts: o.timestamp, sidechain: !!o.isSidechain, agentId: o.agentId };
      if (isHumanPrompt(o)) {
        events.push({ ...base, kind: 'prompt', text: textOf(o.message.content) });
      } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (b?.type === 'tool_result' && b.is_error) {
            const t = typeof b.content === 'string' ? b.content : textOf(b.content);
            events.push({ ...base, kind: 'tool_error', text: t.slice(0, 400) });
          }
        }
      } else if (o.type === 'assistant' && o.message) {
        for (const b of o.message.content || []) {
          if (b?.type === 'text' && b.text?.trim()) {
            events.push({ ...base, kind: 'text', text: b.text });
          } else if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
            events.push({ ...base, kind: 'tool', name: b.name, detail: summarizeToolInput(b.name, b.input) });
          }
        }
      }
    }
  }
  events.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  const summary = (await getSummary()).sessions.find((s) => s.id === id) || null;
  return { session: summary, events: events.slice(-3000), truncated: events.length > 3000 };
}
