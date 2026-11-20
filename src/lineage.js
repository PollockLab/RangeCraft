// Range history as a commit-like DAG. Pure. Each range file is a revision, `parent` (repo path) its parent pointer, `author` its committer.
// Ranges are index entries or file properties: { id, file, author, created, parent?, derived_from? }.
const LEGACY = /,\s*(data\/ranges\/\S+\.geojson)\s*$/; // derived_from was "<by> <created>, <file>"

export const parentOf = p => (typeof p?.parent === 'string' && p.parent) || p?.derived_from?.match?.(LEGACY)?.[1] || null;

const key = r => r.file ?? r.id;

// Map id -> { range, parent: node | null, children: [node] }. A parent that is not in the set (or points at itself) leaves a root.
export function buildGraph(ranges) {
  const byFile = new Map(ranges.map(r => [key(r), r]));
  const nodes = new Map(ranges.map(r => [r.id, { range: r, parent: null, children: [] }]));
  for (const n of nodes.values()) {
    const p = byFile.get(parentOf(n.range)), pn = p && p !== n.range && nodes.get(p.id);
    if (pn) { n.parent = pn; pn.children.push(n); }
  }
  for (const n of nodes.values()) n.children.sort((a, b) => a.range.created.localeCompare(b.range.created));
  return nodes;
}

// Ancestor chain of a range id, oldest first, ending at the range itself. Stops at a cycle.
export function log(graph, id) {
  const out = [], seen = new Set();
  for (let n = graph.get(id); n && !seen.has(n); n = n.parent) { seen.add(n); out.unshift(n); }
  return out;
}

// Map lowercased author -> that author's ranges, oldest first.
export function byAuthor(ranges) {
  const out = new Map();
  for (const r of [...ranges].sort((a, b) => String(a.created).localeCompare(String(b.created)))) {
    const k = String(r.author).toLowerCase();
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}
