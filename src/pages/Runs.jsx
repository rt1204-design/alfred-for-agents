import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import { AgentAvatar, Empty, Icon, Loading, Status } from '../components/ui.jsx';
import { fmtAgo, fmtCost, fmtTokens, totalTokens } from '../format.js';

export default function Runs({ runs, loadRuns, runId, agents }) {
  // Refresh the list while anything is running so statuses stay current.
  const anyRunning = runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(loadRuns, 2000);
    return () => clearInterval(t);
  }, [anyRunning, loadRuns]);

  const selected = runId || runs[0]?.id;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Section iv<span className="sep" />Errands</div>
          <h1>Runs</h1>
          <p>Every task you’ve given an agent, followed live as it works.</p>
        </div>
        <div className="spacer" />
        <a className="btn primary" href="#/agents"><Icon name="plus" /> New run</a>
      </div>
      {runs.length === 0 ? (
        <div className="card">
          <Empty art="scene" title="No errands yet">
            <a href="#/agents">Choose an agent</a> and give it a task. You can follow its thinking and tool calls here as it works.
          </Empty>
        </div>
      ) : (
        <div className="run-layout">
          <nav className="card run-list" aria-label="Runs">
            <div className="run-list-head">{runs.length} {runs.length === 1 ? 'run' : 'runs'}</div>
            {runs.map((r) => (
              <a key={r.id} href={`#/runs/${r.id}`} className={`run-item ${r.id === selected ? 'active' : ''}`} aria-current={r.id === selected ? 'page' : undefined}>
                <AgentAvatar agent={r} agents={agents} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <div className="cell-title clamp">{r.preview}</div>
                  <div className="cell-sub">
                    <Status status={r.status} />
                    <span>{r.agentName} · {fmtAgo(r.createdAt)}</span>
                  </div>
                </div>
              </a>
            ))}
          </nav>
          {selected && <RunView key={selected} id={selected} agents={agents} onChange={loadRuns} />}
        </div>
      )}
    </>
  );
}

function RunView({ id, agents, onChange }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  const bottom = useRef(null);
  const stick = useRef(true);

  // Subscribe to live updates; the server sends the full run on connect.
  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onmessage = (e) => {
      const r = JSON.parse(e.data);
      setRun(r);
      if (r.status !== 'running') {
        es.close();
        onChange();
      }
    };
    es.onerror = () => {
      es.close();
      api.run(id).then(setRun).catch((err) => setError(err.message));
    };
    return () => es.close();
  }, [id, streamKey, onChange]);

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [run]);

  async function send(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.continueRun(id, reply);
      setReply('');
      setStreamKey((k) => k + 1);
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    try {
      await api.retryRun(id);
      setStreamKey((k) => k + 1);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm('Delete this run?')) return;
    await api.deleteRun(id);
    onChange();
    window.location.hash = '#/runs';
  }

  if (!run) return <div className="card">{error ? <Empty title={error} /> : <Loading />}</div>;
  const running = run.status === 'running';
  const agent = <AgentAvatar agent={run} agents={agents} />;
  const turns = groupTurns(run.messages);
  // The reply being streamed joins the agent's current turn.
  if (run.live || running) {
    let last = turns.at(-1);
    if (!last || last.role !== 'agent') turns.push((last = { role: 'agent', parts: [] }));
    last.live = true;
    const blocks = run.live?.content.filter(Boolean) || [];
    blocks.forEach((b, i) => last.parts.push(<Block key={`live-${i}`} b={b} live={i === blocks.length - 1} />));
    if (running && !blocks.length) {
      last.parts.push(
        <div key="attending" className="attending">
          <span className="dots"><span /><span /><span /></span> On it…
        </div>,
      );
    }
  }

  return (
    <section className="card run-sheet" aria-label={`Run by ${run.agentName}`}>
      <div className="run-top">
        <AgentAvatar agent={run} agents={agents} size="lg" />
        <div className="who">
          <h2>{run.agentName}</h2>
          <Status status={run.status} />
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="run-meta">
          <span><b>{run.runner === 'cli' ? 'Subscription' : 'API key'}</b></span>
          <span><b>{run.model}</b></span>
          <span>effort <b>{run.config?.effort}</b></span>
          <span><b>{fmtTokens(totalTokens(run.usage))}</b> tokens</span>
          <span title={run.runner === 'cli' ? 'API-price equivalent; not charged on a subscription' : undefined}>
            <b>{fmtCost(run.cost)}</b>{run.runner === 'cli' ? ' equiv.' : ''}
          </span>
        </div>
        {running ? (
          <button className="btn sm danger" onClick={() => api.stopRun(id)}><Icon name="stop" /> Stop</button>
        ) : (
          <button className="btn sm ghost danger" onClick={remove} aria-label="Delete run" title="Delete run"><Icon name="trash" /></button>
        )}
      </div>

      <div className="conv" onWheel={(e) => { stick.current = e.deltaY > 0; }}>
        {turns.map((t, i) => (
          t.role === 'user' ? (
            <div key={i} className="turn turn-user">
              <div className="turn-who"><span className="label">You</span></div>
              <div className="turn-body">{t.text}</div>
            </div>
          ) : (
            <div key={i} className="turn turn-agent">
              <div className="turn-who">{agent}</div>
              <div className="turn-body" aria-live={t.live ? 'polite' : undefined}>{t.parts}</div>
            </div>
          )
        ))}
        {run.error && (
          <div className="alert error row" style={{ margin: '12px 0 0', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><strong>Run failed.</strong> {run.error}</div>
            {run.messages.at(-1)?.role === 'user' && <button className="btn sm" onClick={retry}><Icon name="refresh" /> Retry</button>}
          </div>
        )}
        {error && <div className="alert error" style={{ margin: '12px 0 0' }}>{error}</div>}
        {run.status === 'refused' && <div className="alert error" style={{ margin: '12px 0 0' }}>The model declined this request.</div>}
        {run.status === 'stopped' && <div className="run-note">Stopped before finishing.</div>}
        <div ref={bottom} />
      </div>

      <form className="composer" onSubmit={send}>
        <textarea
          className="textarea" rows={1} value={reply} disabled={running}
          placeholder={running ? 'Wait for the agent to finish…' : `Send ${run.agentName} a follow-up…`}
          aria-label="Follow-up message"
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
        />
        <button className="btn primary" disabled={running || busy || !reply.trim()}><Icon name="send" /> Send</button>
      </form>
    </section>
  );
}

// Fold the message list into turns: each thing you typed, then everything the
// agent did in reply (its blocks plus the tool results the CLI fed back).
function groupTurns(messages) {
  const turns = [];
  messages.forEach((m, i) => {
    if (m.role === 'user' && typeof m.content === 'string') {
      turns.push({ role: 'user', text: m.content });
      return;
    }
    let last = turns.at(-1);
    if (!last || last.role !== 'agent') turns.push((last = { role: 'agent', parts: [] }));
    if (m.role === 'assistant') m.content.forEach((b, j) => last.parts.push(<Block key={`${i}-${j}`} b={b} />));
    else m.content.forEach((b, j) => last.parts.push(<ToolResult key={`${i}-${j}`} b={b} />));
  });
  return turns;
}

function ToolResult({ b }) {
  if (b.type !== 'tool_result') return null;
  const text = typeof b.content === 'string' ? b.content : (b.content || []).map((c) => c.text || '').join('\n');
  const first = text.trim().split('\n')[0] || '(no output)';
  return (
    <details className={`blk-tool ${b.is_error ? 'err' : ''}`}>
      <summary>{b.is_error ? 'Error: ' : '→ '}{first.slice(0, 160)}</summary>
      <pre>{text.slice(0, 6000)}</pre>
    </details>
  );
}

function Block({ b, live }) {
  switch (b.type) {
    case 'text':
      return <Markdown className={`blk-text ${live ? 'cursor' : ''}`} text={b.text} />;
    case 'thinking':
      if (!b.thinking) return null;
      return (
        <details className="blk-thinking" open={live}>
          <summary>{live ? 'thinking…' : 'thinking'}</summary>
          {b.thinking}
        </details>
      );
    case 'server_tool_use': {
      const what = b.input?.query || b.input?.url || '';
      const verb = b.name === 'web_search' ? 'Searching the web' : b.name === 'web_fetch' ? 'Reading' : b.name;
      return <div className="blk-tool"><b>{verb}</b> {what}</div>;
    }
    case 'tool_use': {
      const i = b.input || {};
      const what = i.command ?? i.file_path ?? i.pattern ?? i.query ?? i.url ?? i.path ?? '';
      return <div className="blk-tool"><b>{b.name}</b> <span className="mono">{String(what).slice(0, 300)}</span></div>;
    }
    case 'web_search_tool_result': {
      if (!Array.isArray(b.content)) return <div className="blk-tool err">Search failed: {b.content?.error_code}</div>;
      return (
        <div className="blk-tool">
          <b>{b.content.length} results</b>
          <ul>
            {b.content.slice(0, 6).map((r) => (
              <li key={r.url}>
                {/^https?:\/\//i.test(r.url || '')
                  ? <a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a>
                  : r.title || r.url}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'web_fetch_tool_result': {
      const c = b.content;
      if (c?.type?.endsWith('error')) return <div className="blk-tool err">Fetch failed: {c.error_code}</div>;
      return <div className="blk-tool"><b>Read</b> {c?.content?.title || c?.url}</div>;
    }
    default:
      return null;
  }
}
