import { useMemo, useState } from 'react';
import { BarChart, Empty, HBars, Icon, Segmented, Stat, Status } from '../components/ui.jsx';
import { dayKey, fmtAgo, fmtCost, fmtNum, fmtTokens, totalTokens } from '../format.js';

const RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Claude Code activity on this machine, plus the agents you run from here.</p>
        </div>
        <div className="spacer" />
        <Segmented options={RANGES} value={range} onChange={setRange} />
        <button className="btn" onClick={() => loadSummary(true)} disabled={loadingSummary}>
          <Icon name="refresh" className={loadingSummary ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {summaryError && <div className="alert error"><strong>Couldn't read Claude Code logs:</strong> {summaryError}</div>}

      {!r ? (
        <div className="card"><Empty title="Loading…">Reading Claude Code session logs.</Empty></div>
      ) : (
        <div className="stack">
          <div className="grid kpis">
            <Stat label="Claude Code sessions" value={fmtNum(r.sessions.length)} note={`active in the last ${range} days`} />
            <Stat label="Est. Claude Code cost" value={fmtCost(r.cost)} note="at API list prices" />
            <Stat label="Tokens processed" value={fmtTokens(r.tokens)} note={`${fmtNum(r.prompts)} prompts`} />
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
              <div className="card-head"><h2>Top tools</h2><span className="sub">calls</span></div>
              <div className="card-body">
                <HBars items={Object.entries(r.tools).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} />
              </div>
            </div>
          </div>

          <div className="grid halves">
            <div className="card">
              <div className="card-head">
                <h2>Recent Claude Code sessions</h2>
                <div className="spacer" />
                <a href="#/sessions" className="btn sm ghost">View all</a>
              </div>
              <div className="card-body" style={{ paddingTop: 6 }}>
                {r.sessions.length === 0 ? (
                  <Empty title="No sessions in this range" />
                ) : (
                  <table>
                    <tbody>
                      {r.sessions.slice(0, 6).map((s) => (
                        <tr key={s.id} className="clickable" onClick={() => (window.location.hash = `#/sessions/${s.id}`)}>
                          <td style={{ paddingLeft: 0 }}>
                            <div className="cell-title clamp">{s.title || s.firstPrompt || 'Untitled session'}</div>
                            <div className="cell-sub">{s.project} · {fmtAgo(s.end)}</div>
                          </td>
                          <td className="num" style={{ paddingRight: 0 }}>
                            <div>{fmtCost(s.cost)}</div>
                            <div className="cell-sub">{fmtTokens(s.totalTokens)} tok</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Agent runs</h2>
                <span className="sub">{agents.length} agents · {fmtCost(agentCost)} total</span>
                <div className="spacer" />
                <a href="#/runs" className="btn sm ghost">View all</a>
              </div>
              <div className="card-body" style={{ paddingTop: 6 }}>
                {runs.length === 0 ? (
                  <Empty title="No runs yet">
                    <a href="#/agents">Pick an agent</a> and give it a task.
                  </Empty>
                ) : (
                  <table>
                    <tbody>
                      {runs.slice(0, 6).map((x) => (
                        <tr key={x.id} className="clickable" onClick={() => (window.location.hash = `#/runs/${x.id}`)}>
                          <td style={{ paddingLeft: 0 }}>
                            <div className="cell-title clamp">{x.preview}</div>
                            <div className="cell-sub">{x.agentName} · {fmtAgo(x.createdAt)}</div>
                          </td>
                          <td className="num" style={{ paddingRight: 0 }}>
                            <Status status={x.status} />
                            <div className="cell-sub">{fmtCost(x.cost)} · {fmtTokens(totalTokens(x.usage))} tok</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
