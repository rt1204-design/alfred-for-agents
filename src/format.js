export function fmtTokens(n) {
  if (n == null) return '–';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function fmtCost(n) {
  if (n == null) return '–';
  if (n > 0 && n < 0.01) return '<$0.01';
  return '$' + n.toFixed(2);
}

export function fmtNum(n) {
  return n == null ? '–' : n.toLocaleString();
}

export function fmtDate(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtAgo(ts) {
  if (!ts) return '–';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

// A clock time for today, otherwise a short date.
export function fmtWhen(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDuration(a, b) {
  if (!a || !b) return '–';
  const s = Math.max(0, (new Date(b) - new Date(a)) / 1000);
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return (s / 3600).toFixed(1) + 'h';
}

export function totalTokens(u) {
  return u ? u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h : 0;
}

// Local YYYY-MM-DD, matching the server's day buckets.
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
