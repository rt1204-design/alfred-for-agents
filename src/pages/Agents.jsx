import { useState } from 'react';
import { api } from '../api.js';
import { Empty, Icon } from '../components/ui.jsx';
import { fmtCost } from '../format.js';

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
    return { count: rs.length, cost: rs.reduce((a, r) => a + (r.cost || 0), 0) };
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
          <h1>Agents</h1>
          <p>Reusable Claude configurations: a model, a system prompt and the tools it may use.</p>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEditing(BLANK)}><Icon name="plus" /> New agent</button>
      </div>

      <CliBanner health={health} usesApi={agents.some((a) => a.runner === 'api')} />

      {agents.length === 0 ? (
        <div className="card"><Empty title="No agents yet">Create one to get started.</Empty></div>
      ) : (
        <div className="agent-grid">
          {agents.map((a) => {
            const st = statsFor(a.id);
            return (
              <div className="card agent-card" key={a.id}>
                <div className="row" style={{ gap: 12 }}>
                  <div className="agent-avatar">{a.name.slice(0, 1).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <h3>{a.name}</h3>
                    <div className="cell-sub">{st.count} runs · {fmtCost(st.cost)}</div>
                  </div>
                </div>
                <p className="clamp">{a.description || a.systemPrompt || 'No description'}</p>
                <div className="chips">
                  <span className="chip">{a.runner === 'api' ? 'API key' : 'Subscription (CLI)'}</span>
                  <span className="chip">{models.find((m) => m.id === a.model)?.label.replace(' (default)', '') || a.model}</span>
                  <span className="chip">effort: {a.effort}</span>
                  {a.webSearch && <span className="chip">web search</span>}
                  {a.webFetch && <span className="chip">web fetch</span>}
                  {a.runner !== 'api' && a.fileAccess !== 'none' && <span className="chip">files: {a.fileAccess}</span>}
                  {a.runner !== 'api' && a.allowCommands && <span className="chip">commands</span>}
                </div>
                <div className="actions">
                  <button className="btn primary sm" onClick={() => setLaunching(a)}><Icon name="play" /> Run</button>
                  <button className="btn sm" onClick={() => setEditing(a)}><Icon name="edit" /> Edit</button>
                  <div style={{ flex: 1 }} />
                  <button className="btn sm ghost danger" onClick={() => remove(a)} aria-label="Delete agent"><Icon name="trash" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <AgentEditor
          agent={editing}
          models={models}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadAgents(); }}
        />
      )}
      {launching && (
        <LaunchDialog
          agent={launching}
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

function AgentEditor({ agent, models, onClose, onSaved }) {
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
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={save}>
        <h2>{agent.id ? 'Edit agent' : 'New agent'}</h2>
        {error && <div className="alert error">{error}</div>}
        <div className="form-grid">
          <div className="field full">
            <label>Name</label>
            <input className="input" value={form.name} onChange={set('name')} required autoFocus />
          </div>
          <div className="field full">
            <label>Description</label>
            <input className="input" value={form.description} onChange={set('description')} placeholder="What this agent is for" />
          </div>
          <div className="field full">
            <label>Runs on</label>
            <select className="select" value={form.runner} onChange={set('runner')}>
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
            <label>Model</label>
            <select className="select" value={form.model} onChange={set('model')}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              {!models.some((m) => m.id === form.model) && <option value={form.model}>{form.model}</option>}
            </select>
          </div>
          <div className="field">
            <label>Effort</label>
            <select className="select" value={form.effort} onChange={set('effort')}>
              {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <span className="hint">Higher effort thinks longer and costs more.</span>
          </div>
          <div className="field full">
            <label>System prompt</label>
            <textarea className="textarea" rows={6} value={form.systemPrompt} onChange={set('systemPrompt')} placeholder="Describe the agent's role, how it should work, and what a good answer looks like." />
          </div>
          <div className="field">
            <label>Tools</label>
            <label className="check"><input type="checkbox" checked={form.webSearch} onChange={set('webSearch')} /> Web search</label>
            <label className="check"><input type="checkbox" checked={form.webFetch} onChange={set('webFetch')} /> Web fetch (read URLs)</label>
          </div>
          {form.runner === 'cli' ? (
            <>
              <div className="field">
                <label>Files</label>
                <select className="select" value={form.fileAccess} onChange={set('fileAccess')}>
                  <option value="none">No file access</option>
                  <option value="read">Read files</option>
                  <option value="edit">Read and edit files</option>
                </select>
                <label className="check"><input type="checkbox" checked={form.allowCommands} onChange={set('allowCommands')} /> Run shell commands</label>
              </div>
              <div className="field full">
                <label>Working folder</label>
                <input className="input mono" value={form.workDir} onChange={set('workDir')} placeholder="Leave empty for a private folder per agent (data/workspaces)" />
                <span className="hint">
                  The folder the agent works in. File and command access are pre-approved here, so only point it at folders you trust it with.
                </span>
              </div>
            </>
          ) : (
            <div className="field">
              <label>Max output tokens</label>
              <input className="input" type="number" min={1024} max={128000} step={1024} value={form.maxTokens} onChange={set('maxTokens')} />
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save agent'}</button>
        </div>
      </form>
    </div>
  );
}

function LaunchDialog({ agent, onClose, onStarted }) {
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
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={go}>
        <h2>Run {agent.name}</h2>
        {error && <div className="alert error">{error}</div>}
        <div className="field">
          <label>Task</label>
          <textarea
            className="textarea" rows={6} autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do?"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(e); }}
          />
          <span className="hint">Ctrl+Enter to start</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !prompt.trim()}><Icon name="play" /> Start run</button>
        </div>
      </form>
    </div>
  );
}
