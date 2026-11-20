// Optional relay client: sign in without a GitHub account, submit a range as a PR via the relay.
import { RELAY_URL } from './api.js';

const SESSION = 'rc-session', DRAFT = 'rc-draft';
const store = {
  get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode: sign-in lasts one page view */ } },
  del: k => { try { sessionStorage.removeItem(k); } catch { /* nothing stored */ } },
};
let memory = null; // fallback when sessionStorage is blocked

export const LABELS = { orcid: 'ORCID', inat: 'iNaturalist', github: 'GitHub' };

function decode(token) {
  try {
    const c = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return c.exp * 1000 > Date.now() ? { token, name: c.name, provider: c.provider, verified: c.verified } : null;
  } catch { return null; }
}

// Pick up #token=... after the relay redirects back, then strip it from the URL. Returns an error code or null.
export function takeSession() {
  const h = new URLSearchParams(location.hash.slice(1));
  const token = h.get('token'), error = h.get('error');
  if (token || error) {
    h.delete('token'); h.delete('error');
    history.replaceState(null, '', location.pathname + location.search + (h.size ? `#${h}` : ''));
  }
  if (token && decode(token)) { memory = token; store.set(SESSION, token); }
  return error;
}
export const session = () => { const s = decode(memory || store.get(SESSION) || ''); if (!s) store.del(SESSION); return s; };
export const signOut = () => { memory = null; store.del(SESSION); };

export async function providers() {
  const r = await fetch(`${RELAY_URL}/providers`);
  if (!r.ok) throw new Error(`relay ${r.status}`);
  return (await r.json()).providers || [];
}

export const signInUrl = p => `${RELAY_URL}/auth/${p}/start?return=${encodeURIComponent(location.href)}`;

async function post(path, body, token) {
  const r = await fetch(RELAY_URL + path, { method: 'POST', credentials: 'include', body: JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `relay ${r.status}`);
  return d;
}
export const emailStart = (email, name) => post('/auth/email/start', { email, name, return: location.href });
export const submit = (geojson, message, token) => post('/submit', { geojson, message }, token).then(d => d.url);

// Sign-in leaves the page (and a magic link may open in a new tab), so the drawing and form wait in
// localStorage until the next page load takes them.
export function saveDraft(d) { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* storage blocked: draft is lost */ } }
export function takeDraft() {
  try { const d = JSON.parse(localStorage.getItem(DRAFT)); localStorage.removeItem(DRAFT); return d; } catch { return null; }
}
