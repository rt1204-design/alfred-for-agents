// Reads Claude Code session transcripts (~/.claude/projects/**/*.jsonl) and
// aggregates them into per-session and per-day stats.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearedAt } from './hidden.js';
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

// Log files are untrusted input: coerce every field before using it.
const str = (v, max = 100000) => (typeof v === 'string' ? v.slice(0, max) : '');
// Only well-formed ISO timestamps; anything else would break sorting and date math.
const isoTime = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
// Content blocks as an array of objects, whatever the log contains.
const blocks = (content) => (Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : []);
// Tool names become object keys; keep them away from Object.prototype names.
const toolKey = (v) => {
  const name = str(v, 100) || 'unknown';
  return name === '__proto__' || name === 'constructor' || name === 'prototype' || name in Object.prototype ? `${name}_` : name;
};

function textOf(content) {
  let t;
  if (typeof content === 'string') t = content;
  else if (Array.isArray(content)) {
    t = blocks(content)
      .filter((b) => b.type === 'text')
      .map((b) => str(b.text))
      .join('\n');
  } else return '';
  // Drop harness-injected context so only what the person typed remains.
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function isHumanPrompt(o) {
  if (o.type !== 'user' || o.isMeta || !o.message) return false;
  const c = o.message.content;
  if (blocks(c).some((b) => b.type === 'tool_result')) return false;
  const t = textOf(c).trim();
  if (!t || t.startsWith('<command-') || t.startsWith('<local-command')) return false;
  if (o.origin && typeof o.origin === 'object' && o.origin.kind && o.origin.kind !== 'human') return false;
  return true;
}

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return '';
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
    if (!o || typeof o !== 'object') continue;
    const sid = str(o.sessionId, 100);
    if (!sid) continue;
    const s = get(sid);
    s.files.add(file);
    if (o.type === 'custom-title' || o.type === 'ai-title' || o.type === 'summary') {
      s.title = str(o.customTitle || o.aiTitle || o.title || o.summary, 300) || s.title;
    }
    if (!s.cwd) s.cwd = str(o.cwd, 1000) || null;
    if (!s.gitBranch) s.gitBranch = str(o.gitBranch, 200) || null;
    if (!s.entrypoint) s.entrypoint = str(o.entrypoint, 100) || null;
    if (o.version) s.version = str(o.version, 50) || s.version;
    const ts = isoTime(o.timestamp);
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
      if (str(m.id, 200) && m.usage && typeof m.usage === 'object') {
        s.msgUsage.set(m.id, { model: str(m.model, 100), usage: normalizeUsage(m.usage), day });
      }
      for (const b of blocks(m.content)) {
        if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          const name = toolKey(b.name);
          s.tools[name] = (s.tools[name] || 0) + 1;
          if (day) {
            const d = (s.daily[day] ??= { prompts: 0, tools: {} });
            d.tools[name] = (d.tools[name] || 0) + 1;
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
  // Sessions cleared from Alfred are left out of the lists and every total,
  // and listed separately for the History page.
  const cleared = [];
  for (const s of merged.values()) {
    if (!s.start) continue; // no real messages
    const hiddenAt = clearedAt(s.id);
    if (hiddenAt) {
      cleared.push({
        id: s.id,
        title: s.title,
        firstPrompt: s.firstPrompt,
        project: s.cwd ? path.basename(s.cwd) : s.project,
        start: s.start,
        end: s.end,
        prompts: s.prompts,
        clearedAt: hiddenAt,
      });
      continue;
    }
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

  cleared.sort((a, b) => b.clearedAt.localeCompare(a.clearedAt));
  lastSummary = { projectsDir: PROJECTS_DIR, generatedAt: new Date().toISOString(), sessions, daily: days, cleared };
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
      if (!o || typeof o !== 'object' || o.sessionId !== id) continue;
      // Every field the UI renders is forced to a string: logs are untrusted input.
      const base = { ts: isoTime(o.timestamp), sidechain: !!o.isSidechain, agentId: str(o.agentId, 100) || undefined };
      if (isHumanPrompt(o)) {
        events.push({ ...base, kind: 'prompt', text: textOf(o.message.content) });
      } else if (o.type === 'user' && o.message) {
        for (const b of blocks(o.message.content)) {
          if (b.type === 'tool_result' && b.is_error) {
            const t = typeof b.content === 'string' ? b.content : textOf(b.content);
            events.push({ ...base, kind: 'tool_error', text: t.slice(0, 400) });
          }
        }
      } else if (o.type === 'assistant' && o.message) {
        for (const b of blocks(o.message.content)) {
          if (b.type === 'text' && str(b.text).trim()) {
            events.push({ ...base, kind: 'text', text: b.text });
          } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
            events.push({ ...base, kind: 'tool', name: str(b.name, 100) || 'tool', detail: summarizeToolInput(b.name, b.input) });
          }
        }
      }
    }
  }
  events.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  const all = await getSummary();
  const session = all.sessions.find((s) => s.id === id) || null;
  // A session cleared from Alfred can still be opened from History.
  const cleared = session ? null : all.cleared.find((s) => s.id === id) || null;
  return { session, cleared, events: events.slice(-3000), truncated: events.length > 3000 };
}
