// Screening readout under the propose card: EOO from the drawing, AOO from range-check bins when loaded. Maths lives in eoo.js.
import { eoo, aoo } from './eoo.js';

const km = n => `${Math.round(n).toLocaleString('en-US')} km²`;

export function initEoo({ $, draw, points }) {
  return () => {
    const e = eoo(draw()?.all() ?? []), a = e == null ? null : aoo(points());
    $('eoo').hidden = e == null;
    $('eoo').textContent = e == null ? '' : `EOO (convex hull of your range): ${km(e)}. ${a == null ? '' : `AOO from GBIF records: ${a / 4} cells × 4 km² = ${km(a)}. `}Screening values only; assessors recompute in GeoCAT or SIS.`;
  };
}
