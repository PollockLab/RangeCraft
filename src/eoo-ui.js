// Screening readout under the propose card: EOO from the drawing, AOO from range-check bins when loaded. Maths lives in eoo.js.
import { eoo, aoo } from './eoo.js';

const km = n => `${Math.round(n).toLocaleString('en-US')} km²`;

export function initEoo({ $, draw, points, presence }) {
  return () => {
    const all = draw()?.all() ?? [], e = eoo(all, presence), a = e == null ? null : aoo(points(), all, presence);
    $('eoo').hidden = e == null;
    $('eoo').textContent = e == null ? '' : `EOO (convex hull of your range, extant polygons only): ${km(e)}. ${a == null ? '' : `AOO at least ${km(a)} (${a / 4} occupied 2×2 km cells, lower bound from coarse GBIF bins). `}Screening values only; assessors recompute in GeoCAT or SIS.`;
  };
}
