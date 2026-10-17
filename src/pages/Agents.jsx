import { useState } from 'react';
import { api } from '../api.js';
import { AgentAvatar, Art, Empty, Icon, staffHue } from '../components/ui.jsx';
import { fmtAgo, fmtCost } from '../format.js';

const FALLBACK_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const BLANK = {
  name: '', description: '', runner: 'cli', model: 'claude-opus-5-5', effort: 'high', systemPrompt: '',
  webSearch: false, webFetch: false, fileAccess: 'none', allowCommands: false, workDir: '', maxTokens: 64000,
};

export default function Agents({ agents, loadAgents, runs, loadRuns, health }) {
  const [editing, setEditing] = useState(null); // agent object or BLANK
  const [launching, setLaunching] = useState(null); // agent
  const models = health?.models || FALLBACK_MODELS;

  const statsFor = (id) => {
    const rs = runs.filter((r) => r.agentId === id);
    return { count: rs.length, cost: rs.reduce((a, r) => a + (r.cost || 0), 0), last: rs[0]?.createdAt };
  };

  async function remove(a) {
    if (!confirm(`Delete agent "${a.name}"? Its past runs are kept.`)) return;
    await api.deleteAgent(a.id);
    loadAgents();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Section iii<span className="sep" />Alfred’s staff</div>
          <h1>Agents</h1>
          <p>Each one is a Claude with a role: a model, a standing brief and the tools it’s trusted with.</p>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEditing(BLANK)}><Icon name="plus" /> New agent</button>
      </div>

      <CliBanner health={health} usesApi={agents.some((a) => a.runner === 'api')} />

      {agents.length === 0 ? (
        <div className="card">
          <Empty art="scene" title="No one on staff yet">
            Take on your first agent and it will be ready for errands straight away.
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => setEditing(BLANK)}><Icon name="plus" /> New agent</button>
            </div>
          </Empty>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((a, n) => {
            const st = statsFor(a.id);
            const model = models.find((m) => m.id === a.model)?.label.replace(' (default)', '').replace(/^Claude /, '') || a.model;
            return (
              <article className="staff-card" key={a.id} style={{ '--hue': staffHue(a, agents) }}>
                <div className="staff-portrait">
                  <span className="staff-no">No. {n + 1}</span>
                  <Art name="robot" />
                  <span className="chip staff-runner" title={a.runner === 'api' ? 'Billed per token with your API key' : 'Uses your Claude plan through the Claude Code CLI'}>
                    {a.runner === 'api' ? 'API key' : 'Subscription'}
                  </span>
                </div>
                <div className="staff-body">
                  <div>
                    <h3>{a.name}</h3>
                    <p className="role clamp">{a.description || a.systemPrompt || 'No description'}</p>
                  </div>
                  <div className="chips">
                    <span className="chip strong">{model}</span>
                    <span className="chip">{a.effort} effort</span>
                    {a.webSearch && <span className="chip">web search</span>}
                    {a.webFetch && <span className="chip">web fetch</span>}
                    {a.runner !== 'api' && a.fileAccess && a.fileAccess !== 'none' && <span className="chip">files: {a.fileAccess}</span>}
                    {a.runner !== 'api' && a.allowCommands && <span className="chip">commands</span>}
                  </div>
                  <div className="staff-record">
                    <span><b>{st.count}</b> {st.count === 1 ? 'run' : 'runs'}</span>
                    <span><b>{fmtCost(st.cost)}</b>{a.runner === 'api' ? '' : ' equiv.'}</span>
                    {st.last && <span>last run {fmtAgo(st.last)}</span>}
                  </div>
                </div>
                <div className="actions">
                  <button className="btn primary sm" onClick={() => setLaunching(a)}><Icon name="play" /> Give a task</button>
                  <button className="btn sm" onClick={() => setEditing(a)}><Icon name="edit" /> Edit</button>
                  <div style={{ flex: 1 }} />
                  <button className="btn sm ghost danger" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} title="Delete agent"><Icon name="trash" /></button>
                </div>
              </article>
            );
          })}
          <button className="hire-card" onClick={() => setEditing(BLANK)}>
            <Art name="robot" />
            <strong>Take on another agent</strong>
            <span>A new role, model and set of tools</span>
          </button>
        </div>
      )}

      {editing && (
        <AgentEditor
          agent={editing}
          agents={agents}
          models={models}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadAgents(); }}
        />
      )}
      {launching && (
        <LaunchDialog
          agent={launching}
          agents={agents}
          onClose={() => setLaunching(null)}
          onStarted={(id) => { setLaunching(null); loadRuns(); window.location.hash = `#/runs/${id}`; }}
        />
      )}
    </>
  );
}

function CliBanner({ health, usesApi }) {
  if (!health) return null;
  const cli = health.cli;
  return (
    <>
      {!cli?.bin && (
        <div className="alert">
          <strong>Claude Code CLI not found.</strong> Subscription agents need it. Install it, then sign in:
          <pre className="mono" style={{ margin: '6px 0 0' }}>irm https://claude.ai/install.ps1 | iex{'\n'}claude auth login</pre>
        </div>
      )}
      {cli?.bin && !cli.loggedIn && (
        <div className="alert">
          <strong>Claude Code CLI isn't signed in.</strong> Run <code>claude auth login</code> in a terminal and sign in with your Claude account, then refresh this page.
          <div className="cell-sub mono" style={{ marginTop: 4 }}>Using {cli.bin}</div>
        </div>
      )}
      {usesApi && !health.credentials && (
        <div className="alert">
          <strong>No API key set.</strong> Agents set to "API key" need <code>ANTHROPIC_API_KEY</code> in <code>.env</code>.
        </div>
      )}
    </>
  );
}

function AgentEditor({ agent, agents, models, onClose, onSaved }) {
  const [form, setForm] = useState({ ...BLANK, ...agent });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (agent.id) await api.updateAgent(agent.id, form);
      else await api.createAgent(form);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form className="card modal" onSubmit={save} aria-labelledby="agent-editor-title">
        <div className="modal-head">
          <AgentAvatar agent={form.id ? form : { name: form.name || '?' }} agents={agents} size="lg" />
          <div>
            <h2 id="agent-editor-title">{agent.id ? `Edit ${agent.name}` : 'New agent'}</h2>
            <p>{agent.id ? 'Changes apply to the next run.' : 'Give it a name, a role and the tools it may use.'}</p>
          </div>
        </div>
        <div className="modal-body">
          {error && <div className="alert error">{error}</div>}
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="ag-name">Name</label>
              <input id="ag-name" className="input" value={form.name} onChange={set('name')} required autoFocus />
            </div>
            <div className="field full">
              <label htmlFor="ag-desc">Description</label>
              <input id="ag-desc" className="input" value={form.description} onChange={set('description')} placeholder="What this agent is for" />
            </div>
            <div className="field full">
              <label htmlFor="ag-runner">Runs on</label>
              <select id="ag-runner" className="select" value={form.runner} onChange={set('runner')}>
                <option value="cli">Claude subscription (Claude Code CLI)</option>
                <option value="api">API key (billed per token)</option>
              </select>
              <span className="hint">
                {form.runner === 'cli'
                  ? 'Uses your signed-in Claude Code CLI, so usage counts against your plan limits.'
                  : 'Calls the Claude API directly with ANTHROPIC_API_KEY from .env.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="ag-model">Model</label>
              <select id="ag-model" className="select" value={form.model} onChange={set('model')}>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                {!models.some((m) => m.id === form.model) && <option value={form.model}>{form.model}</option>}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ag-effort">Effort</label>
              <select id="ag-effort" className="select" value={form.effort} onChange={set('effort')}>
                {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <span className="hint">Higher effort thinks longer and costs more.</span>
            </div>
            <div className="field full">
              <label htmlFor="ag-prompt">System prompt</label>
              <textarea id="ag-prompt" className="textarea" rows={6} value={form.systemPrompt} onChange={set('systemPrompt')} placeholder="Describe the agent's role, how it should work, and what a good answer looks like." />
            </div>
            <div className="field">
              <label>Tools</label>
              <label className="check"><input type="checkbox" checked={form.webSearch} onChange={set('webSearch')} /> Web search</label>
              <label className="check"><input type="checkbox" checked={form.webFetch} onChange={set('webFetch')} /> Web fetch (read URLs)</label>
            </div>
            {form.runner === 'cli' ? (
              <>
                <div className="field">
                  <label htmlFor="ag-files">Files</label>
                  <select id="ag-files" className="select" value={form.fileAccess} onChange={set('fileAccess')}>
                    <option value="none">No file access</option>
                    <option value="read">Read files</option>
                    <option value="edit">Read and edit files</option>
                  </select>
                  <label className="check"><input type="checkbox" checked={form.allowCommands} onChange={set('allowCommands')} /> Run shell commands</label>
                </div>
                <div className="field full">
                  <label htmlFor="ag-dir">Working folder</label>
                  <input id="ag-dir" className="input mono" value={form.workDir} onChange={set('workDir')} placeholder="Leave empty for a private folder per agent (data/workspaces)" />
                  <span className="hint">
                    The folder the agent works in. File and command access are pre-approved here, so only point it at folders you trust it with.
                  </span>
                </div>
              </>
            ) : (
              <div className="field">
                <label htmlFor="ag-max">Max output tokens</label>
                <input id="ag-max" className="input" type="number" min={1024} max={128000} step={1024} value={form.maxTokens} onChange={set('maxTokens')} />
              </div>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save agent'}</button>
        </div>
      </form>
    </div>
  );
}

function LaunchDialog({ agent, agents, onClose, onStarted }) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function go(e) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const { id } = await api.startRun(agent.id, prompt);
      onStarted(id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form className="card modal" onSubmit={go} aria-labelledby="launch-title">
        <div className="modal-head">
          <AgentAvatar agent={agent} agents={agents} size="lg" />
          <div>
            <h2 id="launch-title">A task for {agent.name}</h2>
            <p>{agent.description || 'Write it out as you would for a colleague.'}</p>
          </div>
        </div>
        <div className="modal-body">
          {error && <div className="alert error">{error}</div>}
          <div className="field">
            <label htmlFor="launch-task">Task</label>
            <textarea
              id="launch-task" className="textarea ruled" rows={6} autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(e); }}
            />
          </div>
        </div>
        <div className="modal-actions">
          <span className="hint">Ctrl+Enter to start</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !prompt.trim()}><Icon name="play" /> Start run</button>
        </div>
      </form>
    </div>
  );
}
