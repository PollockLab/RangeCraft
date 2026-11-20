// GitHub App: RS256 JWT -> installation token -> branch, file commit, labelled PR. WebCrypto only.
import { b64u } from './token.js';

const API = 'https://api.github.com';
const enc = new TextEncoder();
// Chunked: spreading a 1 MB array into String.fromCharCode overflows the stack.
const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };

// Expects PKCS8 ("BEGIN PRIVATE KEY"); GitHub downloads PKCS1, convert with openssl (see README).
export async function appJwt(appId, pem, now = Date.now()) {
  if (!/BEGIN PRIVATE KEY/.test(pem)) throw new Error('GH_APP_PRIVATE_KEY must be PKCS8 (BEGIN PRIVATE KEY)');
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const t = Math.floor(now / 1000);
  const input = `${b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${b64u(enc.encode(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) })))}`;
  return `${input}.${b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input)))}`;
}

async function gh(token, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rangecraft-relay', 'X-GitHub-Api-Version': '2022-11-28', ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${r.status} ${data.message || ''}`);
  return data;
}

// Opens the PR and returns its URL. A failure after the branch exists deletes the branch.
export async function openPr(env, { path, content, branch, title, body, label = 'relay' }) {
  const repo = env.GH_REPO, base = env.GH_BASE || 'main';
  const jwt = await appJwt(env.GH_APP_ID, env.GH_APP_PRIVATE_KEY);
  const { token } = await gh(jwt, 'POST', `/app/installations/${env.GH_INSTALLATION_ID}/access_tokens`);
  const { object } = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${base}`);
  await gh(token, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: object.sha });
  try {
    await gh(token, 'PUT', `/repos/${repo}/contents/${path}`, {
      message: title, branch, content: toBase64(enc.encode(content)),
    });
    const pr = await gh(token, 'POST', `/repos/${repo}/pulls`, { title, head: branch, base, body });
    await gh(token, 'POST', `/repos/${repo}/issues/${pr.number}/labels`, { labels: [label] }).catch(() => {});
    return pr.html_url;
  } catch (e) {
    await gh(token, 'DELETE', `/repos/${repo}/git/refs/heads/${branch}`).catch(() => {});
    throw e;
  }
}
