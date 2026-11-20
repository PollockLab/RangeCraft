// Screening readout under the propose card: EOO from the drawing, AOO from range-check bins when loaded. Maths lives in eoo.js.
import { eoo, aoo } from './eoo.js';
import { countriesIn } from './countries.js';
import polygonClipping from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';

const km = n => `${Math.round(n).toLocaleString('en-US')} km²`;

let latest = []; // countries of the latest extant drawing, read by the IUCN export
export const latestCountries = () => latest;
let countries; // lazy: data/countries.geojson is fetched the first time a drawing exists
export function initEoo({ $, draw, points, presence }) {
  let seq = 0; // drops out-of-order results while the drawing keeps changing
  const list = async all => {
    const n = ++seq; latest = [];
    countries ??= fetch('data/countries.geojson').then(r => r.json());
    try {
      const c = countriesIn(all, await countries, presence, polygonClipping.intersection);
      if (n === seq) latest = c;
      if (n === seq) $('eoo-countries').textContent = c.length ? `Countries in your range: ${c.map(x => x.name).join(', ')}` : '';
    } catch { countries = null; latest = []; $('eoo-countries').textContent = ''; }
  };
  return () => {
    const all = draw()?.all() ?? [], e = eoo(all, presence), a = e == null ? null : aoo(points(), all, presence);
    $('eoo').hidden = e == null;
    if (e == null) { seq++; latest = []; $('eoo-countries').textContent = ''; } else list(all);
    $('eoo').textContent = e == null ? '' : `EOO (convex hull of your range, extant polygons only): ${km(e)}. ${a == null ? '' : `AOO at least ${km(a)} (${a / 4} occupied 2×2 km cells, lower bound from coarse GBIF bins). `}Screening values only; assessors recompute in GeoCAT or SIS.`;
  };
}
