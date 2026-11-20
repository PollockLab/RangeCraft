# RangeCraft relay

A Cloudflare Worker that lets experts submit a range without a GitHub account. It signs them in (ORCID, iNaturalist, GitHub or an email link), then opens the pull request through a GitHub App. The repository stays the store, the review queue and the timestamp. Plain JS modules, no build step, no runtime dependencies.

Routes: `GET /providers`, `GET /auth/:provider/start?return=`, `GET /auth/:provider/callback`, `POST /auth/email/start`, `GET|POST /auth/email/callback`, `POST /submit`. A provider whose secrets are missing is disabled and absent from `/providers`.

## Admin setup

Replace `<worker>` with your deployed URL (for example `https://rangecraft-relay.<account>.workers.dev`). Every OAuth callback is `https://<worker>/auth/<provider>/callback`.

1. **GitHub App** (Settings, Developer settings, GitHub Apps, New). Name it so its bot login is `rangecraft-relay[bot]` (the repo's `RELAY_BOT` default). Untick Webhook. Repository permissions: Contents read and write, Pull requests read and write, nothing else. Install it on `PollockLab/rangecraft` only. Note the App ID, generate a private key (downloads PKCS1 `.pem`), and note the installation id from the installation URL (`.../installations/<id>`). Convert the key, WebCrypto only reads PKCS8: `openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem`.
2. **ORCID**: developer tools at https://orcid.org/developer-tools (public API client). Redirect URI `https://<worker>/auth/orcid/callback`.
3. **iNaturalist**: https://www.inaturalist.org/oauth/applications/new. Redirect URI `https://<worker>/auth/inat/callback`, confidential app.
4. **GitHub OAuth app** (Settings, Developer settings, OAuth Apps). Callback `https://<worker>/auth/github/callback`.
5. **Resend**: create an API key at https://resend.com, verify a sending domain, pick `MAIL_FROM` such as `RangeCraft <no-reply@yourdomain>`.
6. **KV**: `cd worker && npx wrangler@3 kv namespace create RELAY_KV`, paste the id into `wrangler.toml` (`[[kv_namespaces]]`).
7. **Secrets**, one `npx wrangler@3 secret put NAME` each: `HMAC_KEY` (`openssl rand -base64 48`), `GH_APP_ID`, `GH_INSTALLATION_ID`, `GH_APP_PRIVATE_KEY` (`npx wrangler@3 secret put GH_APP_PRIVATE_KEY < app-pkcs8.pem`), `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `INAT_CLIENT_ID`, `INAT_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`. Skip any provider you do not want.
8. **Deploy**: `npx wrangler@3 deploy`. Check `curl https://<worker>/providers`.
9. **Point the app at it**: set `RELAY_URL` in `src/api.js` to `https://<worker>` and merge. The sign-in UI appears only when `RELAY_URL` is set and `/providers` is non-empty.
10. **Repo settings**: keep squash-only merges. Add a `relay` label if you want a colour (the worker labels PRs `relay`, GitHub creates it otherwise). If Actions asks to approve the bot's first run, approve it.

Local dev: `worker/.dev.vars` (gitignored) with `ALLOW_LOCALHOST=1`, `HMAC_KEY=...` and any provider secrets, then `npx wrangler@3 dev`. Tests: `node --test 'worker/test/*.test.js'` (a bare `node --test worker/` is not accepted by current Node).

## Provider endpoints

Checked 2026-11-19.

| Provider | Authorize | Token | Identity | PKCE |
|---|---|---|---|---|
| ORCID (public API, scope `/authenticate`) | https://orcid.org/oauth/authorize | https://orcid.org/oauth/token (response carries `orcid` and `name`) | token response | not documented, off |
| iNaturalist | https://www.inaturalist.org/oauth/authorize | https://www.inaturalist.org/oauth/token | `GET https://www.inaturalist.org/users/api_token` with the access token, then `GET https://api.inaturalist.org/v1/users/me` with the `api_token` | not verified, off |
| GitHub | https://github.com/login/oauth/authorize | https://github.com/login/oauth/access_token | `GET https://api.github.com/user` | S256, on |
| Email | none | none | Resend `POST https://api.resend.com/emails` | n/a |

Sources: ORCID https://orcid.org/.well-known/openid-configuration and https://info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id/ ; GitHub https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps (`code_challenge`, `code_challenge_method=S256`); Resend https://resend.com/docs/api-reference/emails/send-email ; iNaturalist https://www.inaturalist.org/pages/api+reference and https://www.inaturalist.org/oauth/applications/new. The iNaturalist token and `users/me` endpoints were confirmed to exist (invalid-client and 401 replies), but the `api_token` exchange was not exercised with a real app.

## Security notes

- Tokens are `base64url(json).HMAC-SHA256`, with a `typ` (session, state, magic link) so one cannot stand in for another. Sessions last 2 hours.
- `return` must be on `APP_ORIGIN` (exact origin). `http://localhost` is accepted only with `ALLOW_LOCALHOST=1`.
- OAuth state is signed and bound to the browser by an HttpOnly cookie (login CSRF). PKCE verifiers are derived from the state nonce with the HMAC key, never sent to the browser.
- GitHub and iNaturalist identities use the permanent numeric id (logins can be renamed and reused); the login is carried only for display and lookups.
- The email identity is `verified:false` and its public id is a hash prefix, so the address is never written to the repo. The magic link (15 minutes, one use, nonce in KV) is bound to the requesting browser by a cookie (`SameSite=None`, because the request is cross-site). The address lives only in KV under the link nonce. Without the cookie the link shows a confirmation page with a masked hint (`a***@e***.org`) instead of signing in; its POST needs the relay's own `Origin` and a per-render CSRF value matching a cookie, and the page sends `frame-ancestors 'none'`.
- The app generates a nonce per sign-in (kept in localStorage, because a magic link may open in a new tab), the relay signs it into the session, and the app discards any `#token=` whose nonce differs (login CSRF).
- `/submit` rebuilds the file from an allowlist of properties, sets `submitter` from the session, and drops `github`, `orcid`, `inat_login` and `identity`. The repo's `scripts/validate.py` only accepts `submitter` on new files from the relay bot and freezes it afterwards.
- Rate limits use KV counters (soft caps, KV is eventually consistent).
