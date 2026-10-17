// Desktop shell: runs the dashboard server in-process and shows it in its own
// window, with a tray icon and a notification when an agent run finishes.
import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const root = app.getAppPath();
const iconPath = path.join(root, 'build', 'icon.png');
const trayIconPath = path.join(root, 'build', 'tray.png'); // heavier strokes, drawn for 16-32px

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('com.agentdashboard.app'); // Windows needs this for notifications

// Agents, runs and an optional .env (ANTHROPIC_API_KEY) live in the per-user app data folder.
const userDir = app.getPath('userData');
// The app was called "Agent Dashboard" before; carry its data over on first launch.
const legacyDir = path.join(app.getPath('appData'), 'Agent Dashboard');
if (!fs.existsSync(path.join(userDir, 'data', 'agents.json')) && fs.existsSync(path.join(legacyDir, 'data', 'agents.json'))) {
  fs.cpSync(path.join(legacyDir, 'data'), path.join(userDir, 'data'), { recursive: true });
  if (fs.existsSync(path.join(legacyDir, '.env'))) fs.copyFileSync(path.join(legacyDir, '.env'), path.join(userDir, '.env'));
}
process.env.DATA_DIR ??= path.join(userDir, 'data');
const envFile = path.join(userDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { startServer, runEvents } = await import('../server/index.js');

let win = null;
let tray = null;
let quitting = false;
let port = 0;
let toldAboutTray = false;

const isLocal = (url) => url.startsWith(`http://127.0.0.1:${port}/`);

function showWindow(hash) {
  if (!win) createWindow();
  if (hash) win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Alfred for Agents',
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#f9f9f7',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${port}/`);

  // Links to the web (search results, docs) open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isLocal(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Closing the window keeps the app (and any running agents) alive in the tray.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true;
      new Notification({
        title: 'Alfred is still running',
        body: 'It stays in the system tray. Right-click the tray icon and choose Quit to exit.',
        icon: iconPath,
      }).show();
    }
  });
  win.on('closed', () => (win = null));
}

function buildTrayMenu() {
  const login = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    { label: 'Open Alfred for Agents', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: login.openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    { label: 'Open data folder', click: () => shell.openPath(userDir) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(trayIconPath));
  tray.setToolTip('Alfred for Agents');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => showWindow());
}

runEvents.on('run-finished', (run) => {
  if (run.status === 'stopped' || !Notification.isSupported()) return;
  if (win?.isVisible() && win.isFocused()) return;
  const titles = { completed: 'finished', error: 'failed', refused: 'declined the task' };
  const prompt = run.messages.find((m) => m.role === 'user' && typeof m.content === 'string')?.content || '';
  const n = new Notification({
    title: `${run.agentName} ${titles[run.status] || run.status}`,
    body: run.error || prompt.slice(0, 120),
    icon: iconPath,
  });
  n.on('click', () => showWindow(`#/runs/${run.id}`));
  n.show();
});

app.on('second-instance', () => showWindow());
app.on('before-quit', () => (quitting = true));
app.on('window-all-closed', () => {
  /* stay in the tray */
});

// Not a top-level await: in an ESM entry point that would hold back the 'ready' event.
app.whenReady().then(async () => {
  try {
    port = await startServer({ port: 0, distDir: path.join(root, 'dist') });
    console.log(`Alfred for Agents server on http://127.0.0.1:${port} (data: ${process.env.DATA_DIR})`);
  } catch (err) {
    dialog.showErrorBox('Alfred for Agents could not start', String(err?.stack || err));
    app.exit(1);
    return;
  }
  createTray();
  // Started by "Start with Windows": begin in the tray without a window.
  if (!process.argv.includes('--hidden')) createWindow();
});
