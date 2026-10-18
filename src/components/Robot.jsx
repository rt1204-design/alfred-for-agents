import { useId } from 'react';

// Agent portraits: small geometric robots drawn with one even stroke on a 48
// unit grid. Agents are told apart by quiet variations (antenna, eyes, mouth,
// ears) rather than by color.
const VARIANTS = [
  { antenna: 'ring', eyes: 'dots', mouth: 'smile', ears: 'bars' },
  { antenna: 'twin', eyes: 'dots', mouth: 'line', ears: 'bars' },
  { antenna: 'ring', eyes: 'visor', mouth: 'smile', ears: 'knobs' },
  { antenna: 'dot', eyes: 'dots', mouth: 'smile', ears: 'knobs' },
  { antenna: 'twin', eyes: 'visor', mouth: 'smile', ears: 'none' },
  { antenna: 'dot', eyes: 'wide', mouth: 'line', ears: 'bars' },
];

// The robot itself, as an SVG group in 48x48 units.
function RobotGlyph({ variant = 0 }) {
  const v = VARIANTS[variant % VARIANTS.length];
  return (
    <g className="robot" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="11" y="17" width="26" height="21" rx="7" />
      {v.antenna === 'ring' && <><path d="M24 17v-5" /><circle cx="24" cy="8.5" r="3" /></>}
      {v.antenna === 'twin' && <><path d="M19 17l-3-6.5M29 17l3-6.5" /><circle cx="16" cy="10.5" r="2.2" fill="currentColor" stroke="none" /><circle cx="32" cy="10.5" r="2.2" fill="currentColor" stroke="none" /></>}
      {v.antenna === 'dot' && <><path d="M24 17v-4" /><circle cx="24" cy="10" r="2.6" fill="currentColor" stroke="none" /></>}
      {v.ears === 'bars' && <path d="M6.5 24v7M41.5 24v7" />}
      {v.ears === 'knobs' && <><circle cx="7.5" cy="27.5" r="1.6" fill="currentColor" stroke="none" /><circle cx="40.5" cy="27.5" r="1.6" fill="currentColor" stroke="none" /></>}
      {v.eyes === 'dots' && <><circle cx="19" cy="25.5" r="2" fill="currentColor" stroke="none" /><circle cx="29" cy="25.5" r="2" fill="currentColor" stroke="none" /></>}
      {v.eyes === 'wide' && <><circle cx="18" cy="25.5" r="2.3" fill="currentColor" stroke="none" /><circle cx="30" cy="25.5" r="2.3" fill="currentColor" stroke="none" /></>}
      {v.eyes === 'visor' && <path d="M18 25.5h12" />}
      {v.mouth === 'smile' && <path d="M19.5 31.5q4.5 3.5 9 0" />}
      {v.mouth === 'line' && <path d="M20.5 32.5h7" />}
    </g>
  );
}

export function Robot({ variant = 0, className = '' }) {
  return (
    <svg className={`robot-svg ${className}`} viewBox="0 -1.5 48 48" aria-hidden="true">
      <RobotGlyph variant={variant} />
    </svg>
  );
}

// A stable variant per agent: its place on the team when `agents` is given
// (so neighbours differ), else a hash of its name. Accepts an agent or a run.
export function agentVariant(agent, agents) {
  const id = agent?.agentId || agent?.id;
  const i = agents ? agents.findIndex((a) => a.id === id) : -1;
  if (i >= 0) return i % VARIANTS.length;
  const key = agent?.agentName || agent?.name || id || '';
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % VARIANTS.length;
}

export function AgentAvatar({ agent, agents, size }) {
  return (
    <span className={`agent-avatar ${size || ''}`} aria-hidden="true">
      <Robot variant={agentVariant(agent, agents)} />
    </span>
  );
}

// An agent whose description says it oversees or coordinates the others leads
// the team. Judged from its role, not its name, and only when exactly one
// agent fits.
const LEAD_ROLE = /\b(oversee\w*|overseer|supervis\w*|coordinat\w*)\b/i;
export function findLead(agents) {
  const leads = agents.filter((a) => LEAD_ROLE.test(a.description || ''));
  return leads.length === 1 ? leads[0] : null;
}

// The team at a glance: the lead on top, everyone else below, joined through a
// hub by dotted lines. Agents with a run in progress get a small blue dot.
export function TeamDiagram({ agents, runs = [], max = 6, className = '' }) {
  const gid = useId().replace(/:/g, '');
  const lead = findLead(agents);
  const others = agents.filter((a) => a !== lead);
  const shown = others.slice(0, max);
  const extra = others.length - shown.length;
  const busy = new Set(runs.filter((r) => r.status === 'running').map((r) => r.agentId));

  const W = 360;
  const S = 40; // portrait size
  const hub = { x: W / 2, y: lead ? 104 : 30 };
  const rowY = lead ? 150 : 82;
  const H = rowY + S + 26;
  const slot = (i, n) => (W * (i + 0.5)) / n;

  const node = (a, cx, top, label) => (
    <g key={a.id}>
      <circle cx={cx} cy={top + S / 2} r={S / 2} className="td-tile" fill={`url(#${gid})`} />
      <svg x={cx - S / 2 + 4} y={top + 4} width={S - 8} height={S - 8} viewBox="0 -1.5 48 48" className="td-robot">
        <RobotGlyph variant={agentVariant(a, agents)} />
      </svg>
      {busy.has(a.id) && <circle cx={cx + S / 2 - 4} cy={top + 5} r="4.5" className="td-busy" />}
      {label}
    </g>
  );

  return (
    <svg className={`team-diagram ${className}`} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${agents.length} agents${lead ? `, led by ${lead.name}` : ''}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="td-tile-a" />
          <stop offset="1" className="td-tile-b" />
        </linearGradient>
        <linearGradient id={`${gid}h`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="td-hub-a" />
          <stop offset="1" className="td-hub-b" />
        </linearGradient>
      </defs>
      {lead && <path className="td-link" d={`M${hub.x} ${18 + S + 8}V${hub.y - 12}`} />}
      {shown.map((a, i) => (
        <path key={a.id} className="td-link" d={`M${hub.x} ${hub.y + 12}L${slot(i, shown.length)} ${rowY - 8}`} />
      ))}
      <circle cx={hub.x} cy={hub.y} r="7" className="td-hub" stroke={`url(#${gid}h)`} />
      {lead && node(lead, hub.x, 18, (
        <text x={hub.x + S / 2 + 10} y={18 + S / 2} dy="0.35em" className="td-name lead">{lead.name}</text>
      ))}
      {shown.map((a, i) => node(a, slot(i, shown.length), rowY, (
        <text x={slot(i, shown.length)} y={rowY + S + 16} textAnchor="middle" className="td-name">{a.name}</text>
      )))}
      {extra > 0 && <text x={W - 4} y={H - 4} textAnchor="end" className="td-name">+{extra} more</text>}
    </svg>
  );
}
