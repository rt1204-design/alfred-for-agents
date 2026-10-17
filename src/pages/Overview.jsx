import { useMemo, useState } from 'react';
import { TeamDiagram } from '../components/Robot.jsx';
import { AgentAvatar, BarChart, Empty, HBars, Icon, Loading, Segmented, Stat, Status } from '../components/ui.jsx';
import { dayKey, fmtAgo, fmtCost, fmtDate, fmtNum, fmtTokens, fmtWhen, toolLabel, totalTokens } from '../format.js';

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];
const METRICS = [
  { value: 'cost', label: 'Est. cost', get: (d) => d.cost, fmt: (v) => fmtCost(v) },
  { value: 'output', label: 'Output tokens', get: (d) => d.usage.output, fmt: (v) => fmtTokens(v) },
  { value: 'total', label: 'All tokens', get: (d) => d.totalTokens, fmt: (v) => fmtTokens(v) },
  { value: 'prompts', label: 'Prompts', get: (d) => d.prompts, fmt: (v) => fmtNum(Math.round(v)) },
];

// Build a continuous day series (zero-filled) for the selected range.
function useRangeData(summary, range) {
  return useMemo(() => {
    if (!summary) return null;
    const byDay = Object.fromEntries(summary.daily.map((d) => [d.date, d]));
    const days = [];
    const today = new Date();
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dayKey(d);
      days.push({
        key,
        date: d,
        data: byDay[key] || { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, cost: 0, prompts: 0, sessions: 0, messages: 0, tools: {}, totalTokens: 0 },
      });
    }
    const startKey = days[0].key;
    const sessions = summary.sessions.filter((s) => s.end && dayKey(new Date(s.end)) >= startKey);
    const tools = {};
    let cost = 0, tokens = 0, prompts = 0;
    for (const { data } of days) {
      cost += data.cost;
      tokens += data.totalTokens;
      prompts += data.prompts;
      for (const [n, c] of Object.entries(data.tools)) tools[n] = (tools[n] || 0) + c;
    }
    const toolCalls = Object.values(tools).reduce((a, b) => a + b, 0);
    return { days, sessions, tools, toolCalls, cost, tokens, prompts };
  }, [summary, range]);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const plural = (n, one, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;

export default function Overview({ summary, summaryError, loadingSummary, loadSummary, runs, agents }) {
  const [range, setRange] = useState(30);
  const [metric, setMetric] = useState('cost');
  const r = useRangeData(summary, range);
  const m = METRICS.find((x) => x.value === metric);

  const agentCost = runs.reduce((a, x) => a + (x.cost || 0), 0);
  const chartData = r?.days.map(({ key, date, data }) => ({
    key,
    label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    fullLabel: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    value: m.get(data),
    extra: [`${data.sessions} session${data.sessions === 1 ? '' : 's'} started`, `${fmtNum(data.prompts)} prompts`],
  }));
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });


  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-date">{today}</div>
          <h1>{greeting()}.</h1>
          <p className="hero-lede">
            {!r ? (
              'Reading your Claude Code logs…'
            ) : r.sessions.length === 0 ? (
              <>No Claude Code sessions in the last {range} days.</>
            ) : (
              <>
                In the last {range} days you kept <b>{plural(r.sessions.length, 'Claude Code session')}</b>, using{' '}
                <b>{fmtTokens(r.tokens)} tokens</b> and <b>{plural(r.toolCalls, 'tool call')}</b>, about <b>{fmtCost(r.cost)}</b> at
                API list prices.
              </>
            )}
            {agents.length > 0 && <> Your {agents.length === 1 ? 'agent has' : `${agents.length} agents have`} handled {plural(runs.length, 'run')}.</>}
          </p>
          <div className="hero-controls">
            <Segmented options={RANGES} value={range} onChange={setRange} />
            <button className="btn" onClick={() => loadSummary(true)} disabled={loadingSummary}>
              <Icon name="refresh" className={loadingSummary ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>
        {agents.length > 0 && <TeamDiagram agents={agents} runs={runs} className="hero-art" />}
      </section>

      {summaryError && <div className="alert error"><strong>Couldn't read Claude Code logs:</strong> {summaryError}</div>}

      {!r ? (
        <Loading>Reading the session logs…</Loading>
      ) : (
        <div className="stack">
          <div className="kpis">
            <Stat label="Sessions" value={fmtNum(r.sessions.length)} note={`active in the last ${range} days`} />
            <Stat label="Est. cost" value={fmtCost(r.cost)} note="at API list prices" />
            <Stat label="Tokens" value={fmtTokens(r.tokens)} note={`across ${plural(r.prompts, 'prompt')}`} />
            <Stat label="Tool calls" value={fmtNum(r.toolCalls)} note={`${Object.keys(r.tools).length} distinct tools`} />
          </div>

          <section className="card">
            <div className="card-head">
              <h2>{m.label} per day</h2>
              <div className="spacer" />
              <Segmented options={METRICS} value={metric} onChange={setMetric} />
            </div>
            <div className="card-body">
              <BarChart data={chartData} format={(v) => m.fmt(v)} label={`${m.label} per day`} />
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Most-used tools</h2><span className="sub">calls in this range</span></div>
            <div className="card-body">
              <HBars items={Object.entries(r.tools).map(([name, value]) => ({ label: toolLabel(name), value })).sort((a, b) => b.value - a.value)} />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Recent sessions</h2>
              <span className="sub">Claude Code</span>
              <div className="spacer" />
              <a href="#/sessions" className="btn link">All sessions →</a>
            </div>
            {r.sessions.length === 0 ? (
              <Empty title="No sessions in this range">Sessions you run in Claude Code show up here.</Empty>
            ) : (
              <ul className="entries">
                {r.sessions.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <a className="entry" href={`#/sessions/${s.id}`}>
                      <div className="entry-when" title={fmtDate(s.end)}>{fmtWhen(s.end)}</div>
                      <div>
                        <div className="cell-title clamp">{s.title || s.firstPrompt || 'Untitled session'}</div>
                        <div className="cell-sub">{s.project} · {fmtAgo(s.end)}</div>
                      </div>
                      <div className="entry-figs">
                        <div>{fmtCost(s.cost)}</div>
                        <div className="cell-sub">{fmtTokens(s.totalTokens)} tok</div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Agent runs</h2>
              <span className="sub">{plural(agents.length, 'agent')} · {fmtCost(agentCost)} total</span>
              <div className="spacer" />
              <a href="#/runs" className="btn link">All runs →</a>
            </div>
            {runs.length === 0 ? (
              <Empty title="No runs yet">
                Runs appear here once you give an agent a task.
                <div style={{ marginTop: 12 }}><a className="btn sm" href="#/agents">Give an agent a task</a></div>
              </Empty>
            ) : (
              <ul className="entries">
                {runs.slice(0, 5).map((x) => (
                  <li key={x.id}>
                    <a className="entry with-avatar" href={`#/runs/${x.id}`}>
                      <div className="entry-when" title={fmtDate(x.createdAt)}>{fmtWhen(x.createdAt)}</div>
                      <AgentAvatar agent={x} agents={agents} size="sm" />
                      <div>
                        <div className="cell-title clamp">{x.preview}</div>
                        <div className="cell-sub">{x.agentName} · {fmtAgo(x.createdAt)}</div>
                      </div>
                      <div className="entry-figs">
                        <Status status={x.status} />
                        <div className="cell-sub">{fmtCost(x.cost)} · {fmtTokens(totalTokens(x.usage))} tok</div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
