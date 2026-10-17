import { useMemo, useState } from 'react';
import { Empty, Icon } from '../components/ui.jsx';
import { fmtAgo, fmtCost, fmtDuration, fmtNum, fmtTokens } from '../format.js';

const SORTS = {
  recent: (a, b) => (b.end || '').localeCompare(a.end || ''),
  cost: (a, b) => b.cost - a.cost,
  tokens: (a, b) => b.totalTokens - a.totalTokens,
  tools: (a, b) => b.toolCalls - a.toolCalls,
};

export default function Sessions({ summary, summaryError, loadingSummary, loadSummary }) {
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Claude Code sessions</h1>
          <p className="mono" style={{ fontSize: 12 }}>{summary?.projectsDir}</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => loadSummary(true)} disabled={loadingSummary}>
          <Icon name="refresh" className={loadingSummary ? 'spin' : ''} /> Refresh
        </button>
      </div>
      {summaryError && <div className="alert error"><strong>Couldn't read logs:</strong> {summaryError}</div>}

      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search prompts, titles, folders…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 220 }} value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 180 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Most recent</option>
          <option value="cost">Highest cost</option>
          <option value="tokens">Most tokens</option>
          <option value="tools">Most tool calls</option>
        </select>
        <span className="muted">{fmtNum(rows.length)} sessions</span>
      </div>

      <div className="card">
        {!summary ? (
          <Empty title="Loading…" />
        ) : rows.length === 0 ? (
          <Empty title="No sessions found">Claude Code sessions appear here once they've written logs.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Project</th>
                  <th className="num">Prompts</th>
                  <th className="num">Tool calls</th>
                  <th className="num">Tokens</th>
                  <th className="num">Est. cost</th>
                  <th className="num">Duration</th>
                  <th className="num">Last active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => (window.location.hash = `#/sessions/${s.id}`)}>
                    <td style={{ maxWidth: 380 }}>
                      <div className="cell-title clamp">{s.title || s.firstPrompt || 'Untitled session'}</div>
                      {s.title && s.firstPrompt && <div className="cell-sub clamp">{s.firstPrompt}</div>}
                    </td>
                    <td>
                      <div>{s.project}</div>
                      <div className="cell-sub">{s.entrypoint}{s.gitBranch && s.gitBranch !== 'HEAD' ? ` · ${s.gitBranch}` : ''}</div>
                    </td>
                    <td className="num">{fmtNum(s.prompts)}</td>
                    <td className="num">{fmtNum(s.toolCalls)}</td>
                    <td className="num">{fmtTokens(s.totalTokens)}</td>
                    <td className="num">{fmtCost(s.cost)}</td>
                    <td className="num">{fmtDuration(s.start, s.end)}</td>
                    <td className="num">{fmtAgo(s.end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
