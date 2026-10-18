// Claude Code sessions you've cleared from Alfred. Only their IDs and when you
// cleared them are stored (in Alfred's data folder); Claude Code's own log
// files in ~/.claude/projects are never changed.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.env.DATA_DIR || path.resolve('data'), 'cleared-sessions.json');

let cleared = null; // Map of session id -> ISO time it was cleared

function load() {
  if (cleared) return cleared;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cleared = new Map(Object.entries(raw).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'));
  } catch {
    cleared = new Map();
  }
  return cleared;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(load()), null, 2));
  fs.renameSync(tmp, FILE);
}

/** When the session was cleared (ISO string), or undefined if it's visible. */
export const clearedAt = (id) => load().get(id);

export function clearSessions(ids) {
  const now = new Date().toISOString();
  let n = 0;
  for (const id of ids) {
    if (!load().has(id)) {
      load().set(id, now);
      n++;
    }
  }
  if (n) save();
  return n;
}

export function restoreSessions(ids) {
  let n = 0;
  for (const id of ids) if (load().delete(id)) n++;
  if (n) save();
  return n;
}
