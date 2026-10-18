// Backend tests: request guard, security headers, input validation, CLI
// arguments and the Claude Code log parser. They run against a throwaway data
// folder and crafted logs, never your real data, and start no agent runs.
//   npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-test-'));
const dataDir = path.join(tmp, 'data');
const projectsDir = path.join(tmp, 'projects');
const distDir = path.join(tmp, 'dist');
fs.mkdirSync(path.join(projectsDir, 'demo-project'), { recursive: true });
fs.mkdirSync(distDir);
fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Alfred</title>');

// One crafted transcript: an assistant message logged twice (once per content
// block, as Claude Code does), a harness reminder in the prompt, a tool call,
// a synthetic notice and a malformed line.
const SID = '11111111-2222-3333-4444-555555555555';
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 } };
const lines = [
  { type: 'custom-title', customTitle: 'Demo session', sessionId: SID },
  { type: 'user', sessionId: SID, timestamp: '2026-10-01T10:00:00.000Z', cwd: 'C:\\work\\demo', message: { role: 'user', content: '<system-reminder>harness text</system-reminder>Fix the login bug' } },
  { type: 'assistant', sessionId: SID, timestamp: '2026-10-01T10:00:05.000Z', message: { id: 'msg_1', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'Looking.' }] } },
  { type: 'assistant', sessionId: SID, timestamp: '2026-10-01T10:00:06.000Z', message: { id: 'msg_1', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.js' } }] } },
  { type: 'assistant', sessionId: SID, timestamp: '2026-10-01T10:00:07.000Z', message: { id: 'syn', model: '<synthetic>', usage, content: [{ type: 'text', text: 'Not logged in' }] } },
];
fs.writeFileSync(path.join(projectsDir, 'demo-project', `${SID}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n{not json\n');

// A hostile transcript (pentest LOW-1): wrong types everywhere, prototype-named
// tools and string token counts. Parsing it must neither crash nor corrupt totals.
const EVIL = 'evil-session';
const evil = [
  { sessionId: EVIL, type: 'assistant', timestamp: '2026-10-02T00:00:00Z', message: { content: 5 } },
  { sessionId: EVIL, type: 'assistant', timestamp: 12345, message: { id: 'm1', model: {}, usage: { output_tokens: '999', input_tokens: -5 }, content: [{ type: 'tool_use', name: '__proto__' }, { type: 'tool_use', name: 'constructor' }, { type: 'tool_use', name: { x: 1 } }, null, 7] } },
  { sessionId: EVIL, type: 'assistant', timestamp: '2026-10-02T00:00:01Z', message: { content: [{ type: 'text', text: { toString: 1 } }, { type: 'tool_use', name: 'Bash', input: null }] } },
  { sessionId: EVIL, type: 'user', timestamp: '2026-10-02T00:00:02Z', origin: 'x', message: { content: [{ type: 'tool_result', is_error: true, content: 9 }] } },
  { sessionId: { not: 'a string' }, type: 'user', message: { content: 'ignored' } },
  ['an', 'array'],
  'just a string',
];
fs.writeFileSync(path.join(projectsDir, 'demo-project', 'evil.jsonl'), evil.map((l) => JSON.stringify(l)).join('\n'));

process.env.DATA_DIR = dataDir;
process.env.CLAUDE_PROJECTS_DIR = projectsDir;
const { startServer } = await import('../server/index.js');
const { buildCliArgs } = await import('../server/agents.js');
const { resolveClaudeBin } = await import('../server/claudeCli.js');

let port;
before(async () => {
  port = await startServer({ port: 0, distDir });
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // The server keeps the event loop alive; end the process once tests finish.
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

// Raw HTTP so tests can set Host/Origin headers that fetch() forbids.
function req(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    if (payload !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    r.on('error', reject);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}
const app = () => ({ 'X-Alfred': '1', Origin: `http://127.0.0.1:${port}` });

describe('request guard', () => {
  test('the app itself can read and write', async () => {
    assert.equal((await req('GET', '/api/agents')).status, 200);
    const created = await req('POST', '/api/agents', { headers: app(), body: { name: 'Guard ok' } });
    assert.equal(created.status, 201);
  });

  for (const host of ['evil.example.com', 'localhost.', 'localhost.evil.com', '127.0.0.1.nip.io', '0.0.0.0']) {
    test(`rejects Host "${host}" (DNS rebinding)`, async () => {
      const r = await req('GET', '/api/agents', { headers: { Host: `${host}:${port}` } });
      assert.equal(r.status, 403);
    });
  }

  test('rejects a request with no Host header', async () => {
    // Node's HTTP client always adds Host, so speak raw HTTP/1.0.
    const status = await new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => s.write('GET /api/agents HTTP/1.0\r\n\r\n'));
      let data = '';
      s.on('data', (c) => (data += c));
      s.on('end', () => resolve(Number(data.split(' ')[1])));
      s.on('error', reject);
    });
    assert.equal(status, 403);
  });

  test('accepts local Host spellings', async () => {
    for (const host of [`localhost:${port}`, `LOCALHOST:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
      assert.equal((await req('GET', '/api/agents', { headers: { Host: host } })).status, 200, host);
    }
  });

  test('rejects writes from other websites', async () => {
    for (const origin of ['https://evil.example.com', 'null', 'http://localhost.evil.com', 'file://']) {
      const r = await req('POST', '/api/agents', { headers: { ...app(), Origin: origin }, body: { name: 'x' } });
      assert.equal(r.status, 403, origin);
    }
  });

  test('rejects writes without the X-Alfred header (simple cross-site requests)', async () => {
    const r = await req('POST', '/api/agents', { headers: { 'Content-Type': 'text/plain' }, body: '{"name":"x"}' });
    assert.equal(r.status, 403);
    for (const [method, p] of [['POST', '/api/runs/x/stop'], ['POST', '/api/runs/x/retry'], ['DELETE', '/api/agents/x']]) {
      assert.equal((await req(method, p)).status, 403, `${method} ${p}`);
    }
  });

  test('rejects reads from other websites, including no-cors probes (pentest INFO-1)', async () => {
    assert.equal((await req('GET', '/api/health', { headers: { Origin: 'https://evil.example.com' } })).status, 403);
    for (const site of ['cross-site', 'same-site']) {
      assert.equal((await req('GET', '/api/health', { headers: { 'Sec-Fetch-Site': site } })).status, 403, site);
    }
    for (const site of ['same-origin', 'none']) {
      assert.equal((await req('GET', '/api/health', { headers: { 'Sec-Fetch-Site': site } })).status, 200, site);
    }
  });

  test('never grants CORS', async () => {
    const pre = await req('OPTIONS', '/api/agents', {
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-alfred' },
    });
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
    const get = await req('GET', '/api/agents', { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(get.headers['access-control-allow-origin'], undefined);
  });
});

describe('security headers', () => {
  test('pages carry a strict CSP and anti-framing headers', async () => {
    const r = await req('GET', '/');
    assert.equal(r.status, 200);
    const csp = r.headers['content-security-policy'];
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.doesNotMatch(csp, /https?:/, 'no outside origins: fonts are bundled');
  });

  test('errors are short JSON with no stack traces', async () => {
    const bad = await req('POST', '/api/agents', { headers: app(), body: '{"name": broken' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json, { error: 'Bad request' });
    const big = await req('POST', '/api/agents', { headers: app(), body: JSON.stringify({ name: 'x', systemPrompt: 'x'.repeat(3 * 1024 * 1024) }) });
    assert.equal(big.status, 413);
    assert.doesNotMatch(big.body, /at .*\.js/);
    const missing = await req('GET', '/api/nope');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.json, { error: 'Not found' });
  });
});

describe('agent input validation', () => {
  const create = async (body) => (await req('POST', '/api/agents', { headers: app(), body })).json;

  test('dash-prefixed or odd model IDs fall back to the default', async () => {
    for (const model of ['--dangerously-skip-permissions', 'claude opus', 'a;b', '', ['x']]) {
      assert.equal((await create({ name: 'm', model })).model, 'claude-opus-5-5', JSON.stringify(model));
    }
    assert.equal((await create({ name: 'm', model: 'claude-haiku-5-5' })).model, 'claude-haiku-5-5');
    assert.equal((await create({ name: 'm', model: 'claude-opus-5-5[1m]' })).model, 'claude-opus-5-5[1m]');
  });

  test('enums and limits are enforced', async () => {
    const a = await create({ name: 'x'.repeat(500), effort: 'ultra', fileAccess: 'root', runner: 'shell', maxTokens: 5 });
    assert.equal(a.name.length, 80);
    assert.equal(a.effort, 'high');
    assert.equal(a.fileAccess, 'none');
    assert.equal(a.runner, 'cli');
    assert.equal(a.maxTokens, 1024);
    assert.equal((await create({ name: 'big', maxTokens: 1e12 })).maxTokens, 128000);
  });

  test('unknown fields are dropped and __proto__ cannot pollute objects', async () => {
    const r = await req('POST', '/api/agents', { headers: app(), body: '{"name":"p","__proto__":{"polluted":true},"isAdmin":true}' });
    assert.equal(r.status, 201);
    assert.equal({}.polluted, undefined);
    assert.equal(r.json.isAdmin, undefined);
  });

  test('system prompts are capped so the CLI command line fits (pentest LOW-2)', async () => {
    const a = await create({ name: 'long', systemPrompt: 'x'.repeat(1_000_000) });
    assert.equal(a.systemPrompt.length, 20000);
  });

  test('updating an agent cannot change its id', async () => {
    const a = await create({ name: 'orig' });
    const r = await req('PUT', `/api/agents/${a.id}`, { headers: app(), body: { id: 'hijacked', name: 'renamed' } });
    assert.equal(r.json.id, a.id);
    assert.equal(r.json.name, 'renamed');
  });
});

describe('runs API', () => {
  test('rejects empty prompts and unknown IDs', async () => {
    const agents = (await req('GET', '/api/agents')).json;
    assert.equal((await req('POST', `/api/agents/${agents[0].id}/runs`, { headers: app(), body: { prompt: '   ' } })).status, 400);
    const noAgent = await req('POST', '/api/agents/nope/runs', { headers: app(), body: { prompt: 'hi' } });
    assert.equal(noAgent.status, 404);
    assert.equal(noAgent.json.error, 'Agent not found');
    const noRun = await req('POST', '/api/runs/nope/messages', { headers: app(), body: { prompt: 'hi' } });
    assert.equal(noRun.status, 404);
    assert.equal((await req('GET', '/api/runs/nope')).status, 404);
    assert.equal((await req('GET', '/api/runs/nope/events')).status, 404);
  });
});

describe('Claude Code log parser', () => {
  test('counts each API message once and strips harness text', async () => {
    const s = (await req('GET', '/api/claude-code/summary?refresh=1')).json;
    const session = s.sessions.find((x) => x.id === SID);
    assert.ok(session, 'session parsed');
    assert.equal(session.title, 'Demo session');
    assert.equal(session.firstPrompt, 'Fix the login bug');
    assert.equal(session.apiCalls, 1, 'duplicate message lines and synthetic notices are not counted');
    assert.equal(session.usage.output, 20);
    assert.equal(session.usage.cacheWrite1h, 50);
    assert.equal(session.tools.Read, 1);
    assert.ok(session.cost > 0);
  });

  test('a hostile transcript cannot crash or corrupt the monitor (pentest LOW-1)', async () => {
    const summary = await req('GET', '/api/claude-code/summary?refresh=1');
    assert.equal(summary.status, 200);
    const s = summary.json.sessions.find((x) => x.id === EVIL);
    assert.ok(s, 'evil session still parsed');
    assert.equal(typeof s.usage.output, 'number');
    assert.equal(s.usage.output, 0, 'string token counts are ignored');
    assert.equal(s.usage.input, 0, 'negative token counts are ignored');
    assert.equal(Object.getPrototypeOf(s.tools), Object.prototype);
    for (const v of Object.values(s.tools)) assert.equal(typeof v, 'number');
    assert.ok(summary.json.sessions.every((x) => typeof x.id === 'string'));

    const detail = await req('GET', `/api/claude-code/sessions/${EVIL}`);
    assert.equal(detail.status, 200);
    for (const e of detail.json.events) {
      for (const k of ['text', 'name', 'detail']) if (k in e) assert.equal(typeof e[k], 'string', `${e.kind}.${k}`);
      assert.ok(e.ts === null || typeof e.ts === 'string');
    }
  });

  test('session detail ignores path tricks', async () => {
    for (const id of ['..%2F..%2Fwindows', '%2e%2e', 'x'.repeat(300)]) {
      const r = await req('GET', `/api/claude-code/sessions/${id}`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.events, []);
    }
  });
});

describe('CLI arguments', () => {
  const base = { id: 'a1', name: 'Tester', model: 'claude-haiku-5-5', effort: 'low', systemPrompt: '', webSearch: false, webFetch: false, fileAccess: 'none', allowCommands: false };

  test('a system prompt that looks like a flag stays a value', () => {
    const args = buildCliArgs({ ...base, systemPrompt: '--dangerously-skip-permissions' });
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.ok(args.includes('--append-system-prompt=--dangerously-skip-permissions'));
  });

  test('every value is attached with "=" (no free-standing values)', () => {
    const args = buildCliArgs({ ...base, name: '--evil', systemPrompt: 'x\n--y', webSearch: true, fileAccess: 'edit', allowCommands: true }, '--resume-me');
    assert.equal(args[0], '-p');
    for (const a of args.slice(1)) assert.match(a, /^--[a-zA-Z-]+(=|$)/, a);
    assert.ok(args.includes('--resume=--resume-me'));
  });

  test('tools follow the toggles, and MCP servers and folder settings are off', () => {
    const none = buildCliArgs(base);
    assert.ok(none.includes('--tools='));
    assert.ok(!none.some((a) => a.startsWith('--allowedTools')));
    assert.ok(none.includes('--strict-mcp-config'));
    assert.ok(none.includes('--setting-sources=user'));
    assert.ok(none.includes('--permission-prompts=none'));
    const web = buildCliArgs({ ...base, webSearch: true, webFetch: true });
    assert.ok(web.includes('--tools=WebSearch,WebFetch'));
    assert.ok(!web.join(' ').match(/Bash|PowerShell|Edit|Write/));
  });
});

describe('CLI lookup', () => {
  test('ignores relative PATH entries and missing CLAUDE_BIN', () => {
    const saved = { PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA, CLAUDE_BIN: process.env.CLAUDE_BIN };
    const cwd = process.cwd();
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-bin-'));
    fs.writeFileSync(path.join(fake, 'claude.exe'), '');
    fs.writeFileSync(path.join(fake, 'claude'), '');
    try {
      process.chdir(fake);
      Object.assign(process.env, { PATH: '.', USERPROFILE: fake, HOME: fake, APPDATA: fake, CLAUDE_BIN: path.join(fake, 'missing.exe') });
      assert.equal(resolveClaudeBin(), null);
    } finally {
      process.chdir(cwd);
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });
});

describe('desktop app hardening config', () => {
  test('Electron fuses stay locked down', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const f = pkg.build.electronFuses;
    assert.equal(f.runAsNode, false);
    assert.equal(f.enableNodeOptionsEnvironmentVariable, false);
    assert.equal(f.enableNodeCliInspectArguments, false);
    assert.equal(f.enableEmbeddedAsarIntegrityValidation, true);
    assert.equal(f.onlyLoadAppFromAsar, true);
    assert.equal(f.grantFileProtocolExtraPrivileges, false);
  });

  test('the renderer is sandboxed and only web links open externally', () => {
    const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
    assert.match(main, /sandbox: true/);
    assert.match(main, /contextIsolation: true/);
    assert.match(main, /nodeIntegration: false/);
    assert.match(main, /protocol === 'https:' \|\| protocol === 'http:'/);
    assert.match(main, /setPermissionRequestHandler/);
  });
});
