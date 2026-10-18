import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, Icon, Loading } from '../components/ui.jsx';
import { fmtAgo, fmtCost, fmtDate, fmtDuration, fmtNum, fmtTokens } from '../format.js';

const SORTS = {
  recent: (a, b) => (b.end || '').localeCompare(a.end || ''),
  cost: (a, b) => b.cost - a.cost,
  tokens: (a, b) => b.totalTokens - a.totalTokens,
  tools: (a, b) => b.toolCalls - a.toolCalls,
};

// Clear sessions from Alfred (Claude Code's own logs are untouched) and offer an Undo.
export async function clearSessions(ids, { loadSummary, notify }) {
  const { cleared } = await api.clearSessions(ids);
  await loadSummary();
  notify(
    `Cleared ${cleared} session${cleared === 1 ? '' : 's'} from Alfred. Find ${cleared === 1 ? 'it' : 'them'} in History.`,
    async () => { await api.restoreSessions(ids); await loadSummary(); },
  );
}

export default function Sessions({ summary, summaryError, loadingSummary, loadSummary, notify }) {
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [sort, setSort] = useState('recent');

  const projects = useMemo(
    () => [...new Set((summary?.sessions || []).map((s) => s.project).filter(Boolean))].sort(),
    [summary],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (summary?.sessions || [])
      .filter((s) => !project || s.project === project)
      .filter((s) => !needle || [s.title, s.firstPrompt, s.cwd, s.id].some((v) => v?.toLowerCase().includes(needle)))
      .sort(SORTS[sort]);
  }, [summary, q, project, sort]);
  const totalCost = rows.reduce((a, s) => a + (s.cost || 0), 0);
  const filtered = !!(q.trim() || project);

  async function clearShown() {
    const n = rows.length;
    const msg = filtered
      ? `Clear the ${n} session${n === 1 ? '' : 's'} matching this filter from Alfred?`
      : `Clear all ${n} sessions from Alfred?`;
    if (!confirm(`${msg} Claude Code's own logs aren't touched, and you can restore them from History.`)) return;
    await clearSessions(rows.map((s) => s.id), { loadSummary, notify });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Claude Code sessions</h1>
          <p>Every conversation Claude Code has logged on this machine.</p>
        </div>
        <div className="spacer" />
        {rows.length > 0 && (
          <button className="btn ghost" onClick={clearShown}>
            <Icon name="clear" /> {filtered ? `Clear shown (${rows.length})` : 'Clear all'}
          </button>
        )}
        <button className="btn" onClick={() => loadSummary(true)} disabled={loadingSummary}>
          <Icon name="refresh" className={loadingSummary ? 'spin' : ''} /> Refresh
        </button>
      </div>
      {summaryError && <div className="alert error"><strong>Couldn't read logs:</strong> {summaryError}</div>}

      <div className="filters">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search prompts, titles, folders…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sessions" />
        <select className="select" style={{ maxWidth: 220 }} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 180 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
          <option value="recent">Most recent</option>
          <option value="cost">Highest cost</option>
          <option value="tokens">Most tokens</option>
          <option value="tools">Most tool calls</option>
        </select>
        <span className="count">{fmtNum(rows.length)} sessions · {fmtCost(totalCost)}</span>
      </div>

      <div className="card">
        {!summary ? (
          <Loading>Reading the session logs…</Loading>
        ) : rows.length === 0 ? (
          <Empty title={q || project ? 'No matching sessions' : 'No sessions yet'}>
            {q || project ? 'Try a different search or project.' : 'Claude Code sessions show up here once they’ve written logs.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th className="col-wide">Project</th>
                  <th className="num">Prompts</th>
                  <th className="num col-wide">Tool calls</th>
                  <th className="num">Tokens</th>
                  <th className="num">Est. cost</th>
                  <th className="num col-wide">Duration</th>
                  <th className="num">Last active</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => (window.location.hash = `#/sessions/${s.id}`)}>
                    <td style={{ maxWidth: 380 }}>
                      <a className="cell-title clamp" href={`#/sessions/${s.id}`} style={{ color: 'inherit' }}>{s.title || s.firstPrompt || 'Untitled session'}</a>
                      {s.title && s.firstPrompt && <div className="cell-sub clamp">{s.firstPrompt}</div>}
                      <div className="cell-sub only-narrow">{s.project}</div>
                    </td>
                    <td className="wrap col-wide">
                      <div>{s.project}</div>
                      <div className="cell-sub">{s.entrypoint}{s.gitBranch && s.gitBranch !== 'HEAD' ? ` · ${s.gitBranch}` : ''}</div>
                    </td>
                    <td className="num">{fmtNum(s.prompts)}</td>
                    <td className="num col-wide">{fmtNum(s.toolCalls)}</td>
                    <td className="num">{fmtTokens(s.totalTokens)}</td>
                    <td className="num strong">{fmtCost(s.cost)}</td>
                    <td className="num col-wide">{fmtDuration(s.start, s.end)}</td>
                    <td className="num" title={fmtDate(s.end)}>{fmtAgo(s.end)}</td>
                    <td className="num" style={{ width: 1 }}>
                      <button
                        className="btn sm ghost row-action" aria-label="Clear session" title="Clear from Alfred (moves to History)"
                        onClick={(e) => { e.stopPropagation(); clearSessions([s.id], { loadSummary, notify }); }}
                      >
                        <Icon name="clear" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        Read from <span className="mono">{summary?.projectsDir}</span>
      </p>
    </>
  );
}
