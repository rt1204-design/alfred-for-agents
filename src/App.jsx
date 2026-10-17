import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Art, Icon } from './components/ui.jsx';
import Overview from './pages/Overview.jsx';
import Sessions from './pages/Sessions.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import Agents from './pages/Agents.jsx';
import Runs from './pages/Runs.jsx';

function useHashRoute() {
  const read = () => (window.location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export default function App() {
  const route = useHashRoute();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [agents, setAgents] = useState([]);
  const [runs, setRuns] = useState([]);
  const [health, setHealth] = useState(null);

  const loadSummary = useCallback(async (refresh) => {
    setLoadingSummary(true);
    try {
      setSummary(await api.summary(refresh));
      setSummaryError(null);
    } catch (e) {
      setSummaryError(e.message);
    } finally {
      setLoadingSummary(false);
    }
  }, []);
  const loadAgents = useCallback(() => api.agents().then(setAgents).catch(() => {}), []);
  const loadRuns = useCallback(() => api.runs().then(setRuns).catch(() => {}), []);

  useEffect(() => {
    loadSummary();
    loadAgents();
    loadRuns();
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
  }, [loadSummary, loadAgents, loadRuns]);

  // Keep the Claude Code numbers fresh while the dashboard is open.
  useEffect(() => {
    const t = setInterval(() => loadSummary(), 30000);
    return () => clearInterval(t);
  }, [loadSummary]);

  const section = route[0] || 'overview';
  const ctx = { summary, summaryError, loadingSummary, loadSummary, agents, loadAgents, runs, loadRuns, health };

  let page;
  if (section === 'sessions' && route[1]) page = <SessionDetail id={route[1]} />;
  else if (section === 'sessions') page = <Sessions {...ctx} />;
  else if (section === 'agents') page = <Agents {...ctx} />;
  else if (section === 'runs') page = <Runs {...ctx} runId={route[1]} />;
  else page = <Overview {...ctx} />;

  const running = runs.filter((r) => r.status === 'running').length;
  // Numbered like the sections of a ledger.
  const nav = [
    { id: 'overview', num: 'i', label: 'Overview', href: '#/' },
    { id: 'sessions', num: 'ii', label: 'Claude Code', href: '#/sessions', count: summary?.sessions.length },
    { id: 'agents', num: 'iii', label: 'Agents', href: '#/agents', count: agents.length },
    { id: 'runs', num: 'iv', label: 'Runs', href: '#/runs', count: running ? `${running} live` : runs.length, live: running > 0 },
  ];
  const cli = health?.cli;

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#/" aria-label="Alfred for Agents">
          <Art name="head" />
          <span className="brand-name">
            <Art name="signature" />
            <small>for Agents</small>
          </span>
        </a>
        <nav aria-label="Sections">
          {nav.map((n) => (
            <a key={n.id} href={n.href} className={`nav-link ${section === n.id ? 'active' : ''}`} aria-current={section === n.id ? 'page' : undefined}>
              <span className="nav-num">{n.num}.</span>
              <span className="nav-label">{n.label}</span>
              {n.count != null && <span className={`nav-count ${n.live ? 'live' : ''}`}>{n.count}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          {health && (
            <>
              <div className="hand">{cli?.loggedIn ? 'At your service.' : 'Not quite ready, I’m afraid.'}</div>
              <div className={`service ${cli?.loggedIn ? 'on' : 'off'}`}>
                <span className="dot" />
                {cli?.loggedIn
                  ? `Claude CLI signed in${cli.subscriptionType ? ` · ${cli.subscriptionType}` : ''}`
                  : cli?.bin ? 'Claude CLI not signed in' : 'Claude CLI not installed'}
              </div>
            </>
          )}
          <ThemeToggle />
        </div>
      </aside>
      <main className="main">{page}</main>
    </div>
  );
}

// Auto follows the OS; Day and Evening pin a theme. Remembered on this machine.
const THEMES = [
  { id: 'auto', label: 'Auto theme', icon: 'auto' },
  { id: 'light', label: 'Day theme', icon: 'sun' },
  { id: 'dark', label: 'Evening theme', icon: 'moon' },
];

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('alfred-theme') || 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('alfred-theme', theme);
    } catch {
      // Storage unavailable; the choice just won't be remembered.
    }
  }, [theme]);
  const i = Math.max(0, THEMES.findIndex((t) => t.id === theme));
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    <button className="theme-toggle" onClick={() => setTheme(next.id)} title={`Switch to ${next.label.toLowerCase()}`}>
      <Icon name={THEMES[i].icon} /> {THEMES[i].label}
    </button>
  );
}
