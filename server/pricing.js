// USD per million tokens. Cache writes are priced as multiples of input
// (5-minute 1.25x, 1-hour 2x); cache reads use the per-model rate when known.
const MODELS = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

// Models offered in the agent editor, most capable first.
export const AGENT_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];

function priceFor(model) {
  if (!model) return null;
  if (MODELS[model]) return MODELS[model];
  // Tolerate prefixed or suffixed IDs (e.g. "anthropic.claude-opus-5-5").
  const key = Object.keys(MODELS).find((k) => model.includes(k));
  return key ? MODELS[key] : null;
}

export function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}

// Token counts are only trusted as finite, non-negative numbers (logs can be malformed).
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

// Normalize an API `usage` object into our flat shape.
export function normalizeUsage(u) {
  if (!u || typeof u !== 'object') u = {};
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
  let w5 = count(cc?.ephemeral_5m_input_tokens);
  const w1 = count(cc?.ephemeral_1h_input_tokens);
  if (!cc) w5 = count(u.cache_creation_input_tokens);
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite5m: w5,
    cacheWrite1h: w1,
  };
}

export function addUsage(a, b) {
  for (const k of Object.keys(a)) a[k] += b[k] ?? 0;
  return a;
}

export function totalTokens(u) {
  return u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
}

export function costOf(model, u) {
  const p = priceFor(model);
  if (!p) return 0;
  const cacheRead = p.cacheRead ?? p.input * 0.1;
  return (
    (u.input * p.input +
      u.output * p.output +
      u.cacheRead * cacheRead +
      u.cacheWrite5m * p.input * 1.25 +
      u.cacheWrite1h * p.input * 2) /
    1e6
  );
}
