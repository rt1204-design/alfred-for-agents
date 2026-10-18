import { useEffect, useRef, useState } from 'react';
import { Robot } from './Robot.jsx';

const paths = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  terminal: 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm3 4l3 3-3 3m5 0h5',
  agent: 'M12 3a4 4 0 110 8 4 4 0 010-8zm-7 17a7 7 0 0114 0',
  play: 'M7 4.5v15l12-7.5-12-7.5z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  stop: 'M7 7h10v10H7z',
  trash: 'M5 7h14M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  back: 'M15 18l-6-6 6-6',
  send: 'M4 12l16-8-6 16-3-7-7-1z',
  sun: 'M12 8a4 4 0 110 8 4 4 0 010-8zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6L7 7m10 10l1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  auto: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 0v18',
  clear: 'M6 6l12 12M18 6L6 18',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
};

export function Icon({ name, className }) {
  const filled = name === 'overview' || name === 'play' || name === 'stop';
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

export function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Status({ status }) {
  const labels = { running: 'Running', completed: 'Completed', error: 'Error', stopped: 'Stopped', refused: 'Refused' };
  return (
    <span className={`status ${status}`}>
      <span className="dot" />
      {labels[status] || status}
    </span>
  );
}

// Alfred's hand-drawn head or signature (see scripts/make-art.mjs), inked in
// the theme's color.
export function Art({ name, className = '', style }) {
  return <span className={`art art-${name} ${className}`} style={style} aria-hidden="true" />;
}

// Why the view is empty and what to do next. `robot` adds a small portrait.
export function Empty({ title, children, robot, loading }) {
  return (
    <div className={`empty ${loading ? 'loading' : ''}`}>
      {robot && <span className="agent-avatar lg"><Robot /></span>}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Loading({ children = 'Loading…' }) {
  return <Empty loading title={children} />;
}

// A short-lived message at the bottom of the window, with an optional Undo.
// It stays put while the pointer is over it or one of its buttons has focus.
export function Notice({ notice, onClose }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!notice || paused) return;
    const t = setTimeout(onClose, 10000);
    return () => clearTimeout(t);
  }, [notice, paused, onClose]);
  if (!notice) return null;
  const hold = () => setPaused(true);
  const release = () => setPaused(false);
  return (
    <div className="notice" role="status" onMouseEnter={hold} onMouseLeave={release} onFocus={hold} onBlur={release}>
      <span>{notice.text}</span>
      {notice.undo && (
        <button className="btn sm" onClick={async () => { onClose(); await notice.undo(); }}>
          <Icon name="undo" /> Undo
        </button>
      )}
      <button className="btn sm ghost" onClick={onClose} aria-label="Dismiss"><Icon name="clear" /></button>
    </div>
  );
}

// A row in a list whose main area is a link, with a small action on the right.
export function EntryRow({ href, children, action }) {
  return (
    <li className="entry-row">
      <a className="entry with-avatar" href={href}>{children}</a>
      {action}
    </li>
  );
}

export { AgentAvatar } from './Robot.jsx';

// Horizontal bar list for ranked counts (top tools, models).
export function HBars({ items, format = (v) => v.toLocaleString(), limit = 8 }) {
  const shown = items.slice(0, limit);
  const max = Math.max(1, ...shown.map((i) => i.value));
  if (!shown.length) return <div className="muted">No data in this range.</div>;
  return (
    <div className="hbars">
      {shown.map((i) => (
        <div className="hbar-row" key={i.label} title={`${i.label}: ${format(i.value)}`}>
          <div className="hbar-label">{i.label}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          <div className="hbar-val">{format(i.value)}</div>
        </div>
      ))}
    </div>
  );
}

// Single-series vertical bar chart with a per-bar hover tooltip.
export function BarChart({ data, format, height = 220, label }) {
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(600);
  const ref = useRef(null);
  // Render at the container's real pixel width so text stays at its true size.
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { top: 10, right: 8, bottom: 26, left: 52 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const n = data.length || 1;
  const step = iw / n;
  const gap = Math.min(2 + step * 0.25, 10);
  const bw = Math.max(1, step - gap);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(n / 8);
  const y = (v) => pad.top + ih - (v / max) * ih;

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className={i === 0 ? 'baseline' : 'grid-line'} x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * step + gap / 2;
          const h = Math.max(0, (d.value / max) * ih);
          const r = Math.min(2, bw / 2, h);
          const top = pad.top + ih - h;
          return (
            <g key={d.key}>
              {h > 0 && (
                <path
                  className={`bar ${hover != null && hover !== i ? 'dim' : ''}`}
                  d={`M${x},${pad.top + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${pad.top + ih} Z`}
                />
              )}
              <rect className="hit" x={pad.left + i * step} y={pad.top} width={step} height={ih} onMouseEnter={() => setHover(i)} />
              {i % labelEvery === 0 && (
                <text className="tick" x={x + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && data[hover] && (
        <div
          className="tooltip"
          style={{
            left: `${((pad.left + hover * step + step / 2) / W) * 100}%`,
            top: `${(Math.min(y(data[hover].value), pad.top + ih - 4) / H) * 100}%`,
          }}
        >
          <div className="t-head">{data[hover].fullLabel || data[hover].label}</div>
          <div className="t-val">{format(data[hover].value, true)}</div>
          {data[hover].extra?.map((e) => <div className="t-row" key={e}>{e}</div>)}
        </div>
      )}
    </div>
  );
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
