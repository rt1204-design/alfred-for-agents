import { api } from '../api.js';
import { AgentAvatar, Empty, Icon, Status } from '../components/ui.jsx';
import { fmtAgo, fmtCost, fmtDate, fmtWhen } from '../format.js';

// Everything you've cleared from Alfred. Runs can be restored or deleted for
// good; Claude Code sessions can be restored (their logs were never touched).
export default function History({ clearedRuns, loadRuns, summary, loadSummary, agents, notify }) {
  const sessions = summary?.cleared || [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function restoreRuns(ids) {
    const { restored } = await api.restoreRuns(ids);
    await loadRuns();
    notify(`Restored ${plural(restored, 'run')} to Runs.`, async () => { await api.clearRuns(ids); await loadRuns(); });
  }

  async function deleteRuns(ids) {
    const n = ids.length;
    if (!confirm(`Delete ${n === 1 ? 'this run' : `${n} runs`} for good? This can’t be undone.`)) return;
    const { deleted } = await api.deleteRuns(ids);
    await loadRuns();
    notify(`Deleted ${plural(deleted, 'run')}.`);
  }

  async function restoreSessions(ids) {
    const { restored } = await api.restoreSessions(ids);
    await loadSummary();
    notify(`Restored ${plural(restored, 'session')} to Claude Code.`, async () => { await api.clearSessions(ids); await loadSummary(); });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p>Runs and sessions you’ve cleared. Restore anything to put it back.</p>
        </div>
      </div>
      <p className="history-note">
        Clearing only hides things in Alfred. Claude Code’s own session logs are never changed, and cleared runs stay
        on disk until you delete them here.
      </p>

      <section className="history-section" aria-label="Cleared runs">
        <div className="card-head">
          <h2>Cleared runs</h2>
          <span className="sub">{clearedRuns.length || 'none'}</span>
          <div className="spacer" />
          {clearedRuns.length > 1 && (
            <>
              <button className="btn sm" onClick={() => restoreRuns(clearedRuns.map((r) => r.id))}><Icon name="undo" /> Restore all</button>
              <button className="btn sm ghost danger" onClick={() => deleteRuns(clearedRuns.map((r) => r.id))}><Icon name="trash" /> Delete all forever</button>
            </>
          )}
        </div>
        {clearedRuns.length === 0 ? (
          <Empty title="No cleared runs">Use Clear on the Runs page to tidy up finished runs; they’ll wait here.</Empty>
        ) : (
          <ul className="entries">
            {clearedRuns.map((r) => (
              <li key={r.id} className="entry-row">
                <a className="entry with-avatar" href={`#/runs/${r.id}`}>
                  <div className="entry-when" title={fmtDate(r.createdAt)}>{fmtWhen(r.createdAt)}</div>
                  <AgentAvatar agent={r} agents={agents} size="sm" />
                  <div>
                    <div className="cell-title clamp">{r.preview}</div>
                    <div className="cell-sub">{r.agentName} · cleared {fmtAgo(r.clearedAt)}</div>
                  </div>
                  <div className="entry-figs">
                    <Status status={r.status} />
                    <div className="cell-sub">{fmtCost(r.cost)}</div>
                  </div>
                </a>
                <div className="row-actions">
                  <button className="btn sm" onClick={() => restoreRuns([r.id])}><Icon name="undo" /> Restore</button>
                  <button className="btn sm ghost danger" onClick={() => deleteRuns([r.id])} aria-label="Delete run forever" title="Delete forever">
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="history-section" aria-label="Cleared Claude Code sessions">
        <div className="card-head">
          <h2>Cleared Claude Code sessions</h2>
          <span className="sub">{sessions.length || 'none'}</span>
          <div className="spacer" />
          {sessions.length > 1 && (
            <button className="btn sm" onClick={() => restoreSessions(sessions.map((s) => s.id))}><Icon name="undo" /> Restore all</button>
          )}
        </div>
        {!summary ? null : sessions.length === 0 ? (
          <Empty title="No cleared sessions">Use Clear on the Claude Code page to hide sessions you don’t need to see.</Empty>
        ) : (
          <ul className="entries">
            {sessions.map((s) => (
              <li key={s.id} className="entry-row">
                <a className="entry" href={`#/sessions/${s.id}`}>
                  <div className="entry-when" title={fmtDate(s.end)}>{fmtWhen(s.end)}</div>
                  <div>
                    <div className="cell-title clamp">{s.title || s.firstPrompt || 'Untitled session'}</div>
                    <div className="cell-sub">{s.project} · cleared {fmtAgo(s.clearedAt)}</div>
                  </div>
                  <div className="entry-figs"><div className="cell-sub">{s.prompts} prompts</div></div>
                </a>
                <div className="row-actions">
                  <button className="btn sm" onClick={() => restoreSessions([s.id])}><Icon name="undo" /> Restore</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
