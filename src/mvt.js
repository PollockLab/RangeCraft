// Minimal Mapbox vector tile reader for GBIF density tiles: returns [{ x, y, props }] per feature, where
// (x, y) is the mean vertex in tile units (a square's centre) and props holds the feature's tags.
export function readTile(buf) {
  const b = new Uint8Array(buf);
  let p = 0;
  const varint = () => { let v = 0, m = 1, c; do { c = b[p++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; };
  const zz = v => (v % 2 ? -(v + 1) / 2 : v / 2);
  const fields = (end, on) => { while (p < end) { const k = varint(), t = k & 7, f = k >> 3; if (t === 0) on(f, varint()); else if (t === 2) { const n = varint(), s = p; on(f, n, s); p = s + n; } else if (t === 1) p += 8; else if (t === 5) p += 4; else throw new Error('bad tile'); } };
  const out = [];
  fields(b.length, (f, n, s) => {
    if (f !== 3) return;
    const keys = [], vals = [], feats = [];
    fields(s + n, (g, m, t) => {
      if (g === 3) keys.push(new TextDecoder().decode(b.subarray(t, t + m)));
      else if (g === 4) { let v; fields(t + m, (h, x) => { if (h === 4 || h === 5) v = x; else if (h === 6) v = zz(x); }); vals.push(v); }
      else if (g === 2) feats.push([t, m]);
    });
    for (const [t, m] of feats) {
      const tags = [], geom = [];
      p = t;
      fields(t + m, (h, x, y) => {
        if (h === 2) { const e = y + x; p = y; while (p < e) tags.push(varint()); }
        else if (h === 4) { const e = y + x; p = y; while (p < e) geom.push(varint()); }
      });
      const props = {};
      for (let i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      let px = 0, py = 0, sx = 0, sy = 0, k = 0;
      for (let i = 0; i < geom.length;) {
        const cmd = geom[i] & 7, cnt = geom[i++] >> 3;
        for (let j = 0; j < cnt && cmd !== 7; j++) { px += zz(geom[i++]); py += zz(geom[i++]); sx += px; sy += py; k++; }
      }
      if (k) out.push({ x: sx / k, y: sy / k, props });
    }
  });
  return out;
}
