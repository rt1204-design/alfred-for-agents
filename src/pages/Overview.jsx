import { useMemo, useState } from 'react';
import { AgentAvatar, Art, BarChart, Empty, HBars, Icon, Loading, Segmented, Stat, Status } from '../components/ui.jsx';
import { dayKey, fmtAgo, fmtCost, fmtNum, fmtTokens, totalTokens } from '../format.js';

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
const shortWhen = (ts) => {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

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
          <div className="eyebrow">{today}<span className="sep" />The day’s account</div>
          <h1>{greeting()}.</h1>
          <p className="hero-lede">
            {!r ? (
              'I’m reading through your Claude Code logs now.'
            ) : r.sessions.length === 0 ? (
              <>A quiet {range} days: no Claude Code sessions to report.</>
            ) : (
              <>
                Over the last {range} days you kept <b>{plural(r.sessions.length, 'Claude Code session')}</b>, which
                got through <b>{fmtTokens(r.tokens)} tokens</b> and <b>{plural(r.toolCalls, 'tool call')}</b>. At API list
                prices that would come to about <b>{fmtCost(r.cost)}</b>.
              </>
            )}
            {agents.length > 0 && (
              <> Your staff of {agents.length} {agents.length === 1 ? 'agent has' : 'agents have'} handled {plural(runs.length, 'run')}.</>
            )}
          </p>
          <div className="hero-controls">
            <Segmented options={RANGES} value={range} onChange={setRange} />
            <button className="btn" onClick={() => loadSummary(true)} disabled={loadingSummary}>
              <Icon name="refresh" className={loadingSummary ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>
        <Art name="scene" className="hero-art" />
      </section>

      {summaryError && <div className="alert error"><strong>Couldn't read Claude Code logs:</strong> {summaryError}</div>}

      {!r ? (
        <div className="card"><Loading>Reading the session logs…</Loading></div>
      ) : (
        <div className="stack">
          <div className="grid kpis">
            <Stat label="Sessions" value={fmtNum(r.sessions.length)} note={`active in the last ${range} days`} />
            <Stat label="Est. cost" value={fmtCost(r.cost)} note="at API list prices" />
            <Stat label="Tokens processed" value={fmtTokens(r.tokens)} note={`across ${plural(r.prompts, 'prompt')}`} />
            <Stat label="Tool calls" value={fmtNum(r.toolCalls)} note={`${Object.keys(r.tools).length} distinct tools`} />
          </div>

          <div className="grid two">
            <div className="card">
              <div className="card-head">
                <h2>{m.label} per day</h2>
                <div className="spacer" />
                <Segmented options={METRICS} value={metric} onChange={setMetric} />
              </div>
              <div className="card-body">
                <BarChart data={chartData} format={(v) => m.fmt(v)} label={`${m.label} per day`} />
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Most-used tools</h2><span className="sub">calls</span></div>
              <div className="card-body">
                <HBars items={Object.entries(r.tools).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} />
              </div>
            </div>
          </div>

          <div className="grid halves">
            <div className="card">
              <div className="card-head">
                <h2>Recent sessions</h2>
                <span className="sub">Claude Code</span>
                <div className="spacer" />
                <a href="#/sessions" className="btn link">All sessions →</a>
              </div>
              {r.sessions.length === 0 ? (
                <Empty art="bust" title="Nothing in the book yet">Sessions you run in Claude Code will be entered here.</Empty>
              ) : (
                <ul className="entries">
                  {r.sessions.slice(0, 6).map((s) => (
                    <li key={s.id}>
                      <a className="entry" href={`#/sessions/${s.id}`}>
                        <div className="entry-when">{shortWhen(s.end)}</div>
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
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Agent runs</h2>
                <span className="sub">{agents.length} agents · {fmtCost(agentCost)} total</span>
                <div className="spacer" />
                <a href="#/runs" className="btn link">All runs →</a>
              </div>
              {runs.length === 0 ? (
                <Empty art="robot" title="The staff are idle">
                  <a href="#/agents">Choose an agent</a> and give it a task.
                </Empty>
              ) : (
                <ul className="entries">
                  {runs.slice(0, 6).map((x) => (
                    <li key={x.id}>
                      <a className="entry" href={`#/runs/${x.id}`}>
                        <div className="entry-when">{shortWhen(x.createdAt)}</div>
                        <div>
                          <div className="cell-title clamp">{x.preview}</div>
                          <div className="cell-sub row" style={{ gap: 6 }}>
                            <AgentAvatar agent={x} agents={agents} size="xs" />{x.agentName} · {fmtAgo(x.createdAt)}
                          </div>
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
