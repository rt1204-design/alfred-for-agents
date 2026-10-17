import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import { Empty, Icon, Status } from '../components/ui.jsx';
import { fmtAgo, fmtCost, fmtTokens, totalTokens } from '../format.js';

export default function Runs({ runs, loadRuns, runId }) {
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
          <h1>Runs</h1>
          <p>Every task you've given an agent, streamed live.</p>
        </div>
        <div className="spacer" />
        <a className="btn primary" href="#/agents"><Icon name="plus" /> New run</a>
      </div>
      {runs.length === 0 ? (
        <div className="card"><Empty title="No runs yet"><a href="#/agents">Choose an agent</a> and give it a task.</Empty></div>
      ) : (
        <div className="run-layout">
          <div className="card run-list">
            {runs.map((r) => (
              <a key={r.id} href={`#/runs/${r.id}`} className={`run-item ${r.id === selected ? 'active' : ''}`}>
                <div className="cell-title clamp">{r.preview}</div>
                <div className="cell-sub">
                  <Status status={r.status} />
                  <span>{r.agentName}</span>
                  <span>· {fmtAgo(r.createdAt)}</span>
                </div>
              </a>
            ))}
          </div>
          {selected && <RunView key={selected} id={selected} onChange={loadRuns} />}
        </div>
      )}
    </>
  );
}

function RunView({ id, onChange }) {
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

  if (!run) return <div className="card"><Empty title={error || 'Loading…'} /></div>;
  const running = run.status === 'running';

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div className="card-head" style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <h2>{run.agentName}</h2>
        <Status status={run.status} />
        <div className="spacer" />
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
          <button className="btn sm ghost danger" onClick={remove} aria-label="Delete run"><Icon name="trash" /></button>
        )}
      </div>

      <div className="conv" onWheel={(e) => { stick.current = e.deltaY > 0; }}>
        {run.messages.map((m, i) => {
          if (m.role === 'assistant') return <Assistant key={i} blocks={m.content} />;
          if (typeof m.content === 'string') return <div key={i} className="msg-user">{m.content}</div>;
          // Tool results the CLI fed back to the model.
          return <div key={i} className="msg-assistant">{m.content.map((b, j) => <ToolResult key={j} b={b} />)}</div>;
        })}
        {run.live && <Assistant blocks={run.live.content.filter(Boolean)} live />}
        {running && !run.live?.content.length && <div className="muted cursor">Thinking</div>}
        {run.error && (
          <div className="alert error row" style={{ margin: 0, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><strong>Run failed.</strong> {run.error}</div>
            {run.messages.at(-1)?.role === 'user' && <button className="btn sm" onClick={retry}><Icon name="refresh" /> Retry</button>}
          </div>
        )}
        {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
        {run.status === 'refused' && <div className="alert error" style={{ margin: 0 }}>The model declined this request.</div>}
        {run.status === 'stopped' && <div className="muted">Stopped.</div>}
        <div ref={bottom} />
      </div>

      <form className="composer" onSubmit={send}>
        <textarea
          className="textarea" rows={1} value={reply} disabled={running}
          placeholder={running ? 'Wait for the agent to finish…' : 'Send a follow-up…'}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
        />
        <button className="btn primary" disabled={running || busy || !reply.trim()}><Icon name="send" /> Send</button>
      </form>
    </div>
  );
}

function Assistant({ blocks, live }) {
  return (
    <div className="msg-assistant">
      {blocks.map((b, i) => <Block key={i} b={b} live={live && i === blocks.length - 1} />)}
    </div>
  );
}

function ToolResult({ b }) {
  if (b.type !== 'tool_result') return null;
  const text = typeof b.content === 'string' ? b.content : (b.content || []).map((c) => c.text || '').join('\n');
  const first = text.trim().split('\n')[0] || '(no output)';
  return (
    <details className="blk-tool" style={b.is_error ? { color: 'var(--critical)' } : undefined}>
      <summary style={{ cursor: 'pointer' }} className="mono">
        {b.is_error ? 'Error: ' : '→ '}{first.slice(0, 160)}
      </summary>
      <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', maxHeight: 260, overflow: 'auto' }}>{text.slice(0, 6000)}</pre>
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
          <summary>Thinking</summary>
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
      if (!Array.isArray(b.content)) return <div className="blk-tool">Search failed: {b.content?.error_code}</div>;
      return (
        <div className="blk-tool">
          <b>{b.content.length} results</b>
          <ul>
            {b.content.slice(0, 6).map((r) => (
              <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a></li>
            ))}
          </ul>
        </div>
      );
    }
    case 'web_fetch_tool_result': {
      const c = b.content;
      if (c?.type?.endsWith('error')) return <div className="blk-tool">Fetch failed: {c.error_code}</div>;
      return <div className="blk-tool"><b>Read</b> {c?.content?.title || c?.url}</div>;
    }
    default:
      return null;
  }
}
