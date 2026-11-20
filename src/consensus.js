// Agreement layer: where proposing experts converge (data/consensus/<taxonKey>.geojson).
export const PALETTE = ['#fde0dd', '#fa9fb5', '#c51b8a', '#7a0177', '#49006a'];
const get = async p => { try { const r = await fetch(p, { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch { return null; } };

export const loadConsensus = async key => {
  const fc = await get(`data/consensus/${encodeURIComponent(key)}.geojson`);
  return fc?.type === 'FeatureCollection' && fc.features?.length ? fc : null;
};
export async function loadConsensusSummary(key) {
  const a = await get('data/consensus/index.json');
  return Array.isArray(a) ? a.find(e => String(e.taxonKey) === String(key)) || null : null;
}

export const shareFill = ['step', ['get', 'share'], PALETTE[0], 0.2, PALETTE[1], 0.4, PALETTE[2], 0.6, PALETTE[3], 0.8, PALETTE[4]];

const km = v => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
export const summaryText = (s, noun = 'experts') => s
  ? `Agreement index ${Number(s.agreement_index).toFixed(2)} · contested area ${km(s.contested_area_km2)} km² · ${s.voters} ${noun}`
  : '';
export const kOfN = (p, noun = 'experts') => `${p.agree} of ${p.voters} ${noun} agree`;
