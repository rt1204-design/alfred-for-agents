// Locates the Claude Code CLI and reports whether it is signed in.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function onPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    // Relative entries (".") would resolve against the working folder, where a planted claude.exe could sit.
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

// Copy bundled with the Claude desktop app, newest version first.
function desktopBundled() {
  const root = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  if (!fs.existsSync(root)) return null;
  const byVersion = (a, b) => b.localeCompare(a, undefined, { numeric: true });
  for (const ver of fs.readdirSync(root).sort(byVersion)) {
    const vdir = path.join(root, ver);
    if (!fs.statSync(vdir).isDirectory()) continue;
    for (const sub of fs.readdirSync(vdir)) {
      const exe = path.join(vdir, sub, 'claude.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

export function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const userLocal = path.join(process.env.USERPROFILE || process.env.HOME || '', '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return onPath('claude') || (fs.existsSync(userLocal) ? userLocal : null) || desktopBundled();
}

let cached = null;
let cachedAt = 0;

export function cliStatus({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < 15000) return Promise.resolve(cached);
  const bin = resolveClaudeBin();
  if (!bin) {
    cached = { bin: null, loggedIn: false };
    cachedAt = Date.now();
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    // `auth status` exits non-zero when signed out but still prints JSON.
    execFile(bin, ['auth', 'status'], { timeout: 20000, windowsHide: true }, (_err, stdout) => {
      let info = {};
      try {
        info = JSON.parse(stdout);
      } catch {
        /* older CLI or unexpected output */
      }
      cached = {
        bin,
        bundled: bin.includes(path.join('Claude', 'claude-code')),
        loggedIn: !!info.loggedIn,
        authMethod: info.authMethod || null,
        subscriptionType: info.subscriptionType || null,
        email: info.email || null,
      };
      cachedAt = Date.now();
      resolve(cached);
    });
  });
}
