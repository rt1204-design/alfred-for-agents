import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, HBars, Icon, Loading, Stat } from '../components/ui.jsx';
import { fmtCost, fmtDate, fmtDuration, fmtNum, fmtTokens } from '../format.js';

export default function SessionDetail({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showText, setShowText] = useState(true);
  const [showSide, setShowSide] = useState(false);

  useEffect(() => {
    setData(null);
    api.session(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  const events = useMemo(
    () => (data?.events || []).filter((e) => (showText || e.kind !== 'text') && (showSide || !e.sidechain)),
    [data, showText, showSide],
  );

  const s = data?.session;
  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <a href="#/sessions" className="back-link"><Icon name="back" /> All sessions{s?.project ? ` · ${s.project}` : ''}</a>
          <h1 className="clamp">{s?.title || s?.firstPrompt || 'Session'}</h1>
          <p className="mono" style={{ wordBreak: 'break-all' }}>{s?.cwd ? `${s.cwd} · ` : ''}{id}</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!data ? (
        !error && <Loading>Loading the session…</Loading>
      ) : (
        <div className="stack">
          {s && (
            <div className="kpis">
              <Stat label="Est. cost" value={fmtCost(s.cost)} note={Object.keys(s.models).join(', ')} />
              <Stat label="Tokens" value={fmtTokens(s.totalTokens)} note={`${fmtTokens(s.usage.output)} output · ${fmtTokens(s.usage.cacheRead)} cache read`} />
              <Stat label="Prompts / API calls" value={`${fmtNum(s.prompts)} / ${fmtNum(s.apiCalls)}`} />
              <Stat label="Duration" value={fmtDuration(s.start, s.end)} note={`${fmtDate(s.start)} → ${fmtDate(s.end)}`} />
            </div>
          )}
          {s && (
            <section className="card">
              <div className="card-head"><h2>Tools used</h2><span className="sub">calls</span></div>
              <div className="card-body">
                <HBars items={Object.entries(s.tools).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} limit={10} />
              </div>
            </section>
          )}
          <section className="card">
            <div className="card-head">
              <h2>Timeline</h2>
              <span className="sub">{fmtNum(events.length)} events{data.truncated ? ' (latest 3,000)' : ''}</span>
              <div className="spacer" />
              <label className="check"><input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> Replies</label>
              <label className="check"><input type="checkbox" checked={showSide} onChange={(e) => setShowSide(e.target.checked)} /> Subagents</label>
            </div>
            <div className="card-body timeline">
              {events.map((e, i) => (
                <div key={i} className={`ev ev-${e.kind === 'tool_error' ? 'error' : e.kind} ${e.sidechain ? 'side' : ''}`}>
                  <div className="ev-time">{e.ts ? new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}</div>
                  <div className="ev-body">
                    {e.kind === 'tool' ? (<><b>{e.name}</b> {e.detail}</>) : e.text}
                  </div>
                </div>
              ))}
              {events.length === 0 && <Empty title="Nothing to show">Try including replies or subagents.</Empty>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
