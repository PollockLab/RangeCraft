// OAuth 2 authorization-code providers. Endpoints are cited in worker/README.md.
const json = async r => { if (!r.ok) throw new Error(`${new URL(r.url).host} ${r.status}`); return r.json(); };
const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

async function tokenExchange(url, p, env, { code, redirectUri, verifier }) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: env[`${p}_CLIENT_ID`], client_secret: env[`${p}_CLIENT_SECRET`] });
  if (verifier) body.set('code_verifier', verifier);
  const d = await json(await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body }));
  if (!d.access_token) throw new Error('no access_token');
  return d;
}

// pkce is on only where the provider documents it (GitHub). ORCID and iNaturalist: unverified, off.
export const PROVIDERS = {
  orcid: {
    label: 'ORCID', prefix: 'ORCID', pkce: false,
    authorize: 'https://orcid.org/oauth/authorize', scope: '/authenticate',
    async identity(env, args) {
      const t = await tokenExchange('https://orcid.org/oauth/token', 'ORCID', env, args);
      if (!ORCID_RE.test(t.orcid || '')) throw new Error('no ORCID iD in token response');
      return { provider: 'orcid', id: t.orcid, name: t.name || t.orcid, verified: true };
    },
  },
  inat: {
    label: 'iNaturalist', prefix: 'INAT', pkce: false,
    authorize: 'https://www.inaturalist.org/oauth/authorize', scope: '',
    async identity(env, args) {
      const t = await tokenExchange('https://www.inaturalist.org/oauth/token', 'INAT', env, args);
      const { api_token: jwt } = await json(await fetch('https://www.inaturalist.org/users/api_token', { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } }));
      const u = (await json(await fetch('https://api.inaturalist.org/v1/users/me', { headers: { Authorization: jwt, Accept: 'application/json' } }))).results?.[0];
      if (!u?.login) throw new Error('no iNaturalist user');
      return { provider: 'inat', id: u.login, name: u.name || u.login, verified: true };
    },
  },
  github: {
    label: 'GitHub', prefix: 'GITHUB', pkce: true,
    authorize: 'https://github.com/login/oauth/authorize', scope: '',
    async identity(env, args) {
      const t = await tokenExchange('https://github.com/login/oauth/access_token', 'GITHUB', env, args);
      const u = await json(await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rangecraft-relay' } }));
      if (!u.login) throw new Error('no GitHub user');
      return { provider: 'github', id: u.login, name: u.name || u.login, verified: true };
    },
  },
};

export const enabledProviders = env => {
  if (!env.HMAC_KEY) return [];
  const out = Object.entries(PROVIDERS).filter(([, p]) => env[`${p.prefix}_CLIENT_ID`] && env[`${p.prefix}_CLIENT_SECRET`]).map(([k]) => k);
  if (env.RESEND_API_KEY && env.MAIL_FROM && env.KV) out.push('email');
  return out;
};

export async function sendMagicLink(env, to, link) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: 'Sign in to RangeCraft', text: `Open this link within 15 minutes to sign in and submit your range:\n\n${link}\n\nIf you did not ask for this, ignore this email.` }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}
