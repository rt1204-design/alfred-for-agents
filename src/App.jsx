import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './components/ui.jsx';
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
  const nav = [
    { id: 'overview', label: 'Overview', icon: 'overview', href: '#/' },
    { id: 'sessions', label: 'Claude Code', icon: 'terminal', href: '#/sessions', count: summary?.sessions.length },
    { id: 'agents', label: 'Agents', icon: 'agent', href: '#/agents', count: agents.length },
    { id: 'runs', label: 'Runs', icon: 'play', href: '#/runs', count: running ? `${running} live` : runs.length },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img className="brand-mark" src="/alfred-head.png" alt="" />Alfred for Agents</div>
        {nav.map((n) => (
          <a key={n.id} href={n.href} className={`nav-link ${section === n.id ? 'active' : ''}`}>
            <Icon name={n.icon} />
            {n.label}
            {n.count != null && <span className="nav-count">{n.count}</span>}
          </a>
        ))}
        <div className="sidebar-foot">
          {health?.cli?.loggedIn
            ? `CLI signed in${health.cli.subscriptionType ? ` · ${health.cli.subscriptionType}` : ''}`
            : health?.cli?.bin ? 'CLI not signed in' : health ? 'CLI not installed' : ''}
        </div>
      </aside>
      <main className="main">{page}</main>
    </div>
  );
}
