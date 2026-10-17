// Minimal Markdown for agent replies: headings, paragraphs, bullet and numbered
// lists, fenced code, **bold**, *italic*, `code` and [links](url). Builds React
// elements (never raw HTML), so model output can't inject markup.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\*[^*\s][^*]*\*|https?:\/\/[^\s)]+)/g;

function inline(text, keyBase) {
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const label = t.slice(1, t.indexOf(']('));
      out.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer">{label}</a>);
    } else if (t.startsWith('http')) out.push(<a key={key} href={t} target="_blank" rel="noreferrer">{t}</a>);
    else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, className }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={blocks.length} className="md-pre"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      blocks.push(<div key={blocks.length} className={`md-h md-h${h[1].length}`}>{inline(h[2], blocks.length)}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={blocks.length} className="md-list">
          {items.map((it, j) => <li key={j}>{inline(it, `${blocks.length}-${j}`)}</li>)}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={blocks.length} className="md-p">{inline(para.join('\n'), blocks.length)}</p>);
  }
  return <div className={`md ${className || ''}`}>{blocks}</div>;
}
