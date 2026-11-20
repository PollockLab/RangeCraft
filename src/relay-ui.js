// Relay sign-in and submit (no GitHub account needed). Hidden when RELAY_URL is empty.
import { RELAY_URL } from './api.js';
import * as relay from './relay.js';

export function initRelayUi({ $, say, state, patch, current, openPropose, draw, mapReady }) {
  let draft, pending; // pending: the stashed patch, entered once its species is selected
  const load = features => { try { draw().load({ type: 'FeatureCollection', features }); } catch (e) { say(`Could not restore your drawing: ${e.message}`); } };
  const stashDraft = () => relay.saveDraft({ features: draw()?.all() ?? [], patch: state.patch && { taxon: state.taxon.key, base: state.patch.base, shapes: state.patch.shapes, parent: state.patch.parent }, ...Object.fromEntries(['author', 'github', 'orcid', 'inat', 'sources'].map(k => [k, $(k).value])) });
  async function initRelay() {
    if (!RELAY_URL) return;
    const err = relay.takeSession();
    draft = relay.takeDraft();
    pending = draft?.patch;
    if (draft) {
      for (const k of ['author', 'github', 'orcid', 'inat', 'sources']) if (draft[k]) $(k).value = draft[k];
      openPropose(true);
      if (!pending) mapReady.then(() => load(draft.features));
    }
    let enabled;
    try { enabled = await relay.providers(); } catch { return; } // relay down: keep the GitHub route only
    if (!enabled.length) return;
    $('relay').hidden = false;
    $('propose').textContent = 'Have a GitHub account? Propose via GitHub';
    $('propose').classList.remove('primary');
    const s = relay.session();
    $('relay-who').textContent = s ? `Signed in as ${s.name} (${s.provider}${s.verified ? ', verified' : ', unverified'}).` : 'Sign in to submit without a GitHub account.';
    $('relay-submit').hidden = !s;
    $('author-field').hidden = $('me').hidden = !!s; // the session supplies the identity
    $('relay-buttons').replaceChildren(...enabled.filter(p => p !== 'email').map(p => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: `${s ? 'Switch to' : 'Sign in with'} ${relay.LABELS[p]}` });
      b.addEventListener('click', () => { stashDraft(); location.href = relay.signInUrl(p); });
      return b;
    }));
    $('relay-email').hidden = !enabled.includes('email');
    if (err) say(err === 'denied' ? 'Sign-in was cancelled.' : err === 'foreign_token' ? 'Ignored a sign-in link that this browser did not start.' : 'Sign-in failed. Try again or use another provider.');
  }
  $('relay-mail-send').addEventListener('click', async () => {
    try { stashDraft(); await relay.emailStart($('relay-mail').value.trim(), $('author').value.trim()); say('Check your inbox, the link is valid for 15 minutes. Your drawing is restored when you open it.'); }
    catch (e) { say(e.message); }
  });
  $('relay-submit').addEventListener('click', async () => {
    const s = relay.session();
    if (!s) { say('Your sign-in expired. Sign in again.'); $('relay-submit').hidden = true; return; }
    const fc = current(true);
    if (!fc) return;
    if (!fc.properties.sources) { say('Add sources and evidence before submitting.'); $('sources').focus(); return; }
    $('relay-submit').disabled = true;
    say('Submitting...');
    try {
      const url = await relay.submit(fc, fc.properties.sources, s.token);
      $('relay-link').replaceChildren('Submitted: ', Object.assign(document.createElement('a'), { href: url, textContent: url, target: '_blank', rel: 'noopener' }));
      say('Pull request opened. Reviewers will take it from here.');
    } catch (e) { say(e.message); }
    $('relay-submit').disabled = false;
  });
  initRelay();
  // Called once the species is selected: re-enter patch mode with the stashed shapes, then the polygons drawn on top.
  return { async restorePatch(key) {
    const p = pending;
    if (!p || p.taxon !== key) return;
    pending = null;
    await mapReady;
    try { if (await patch.enter(p.base, p.shapes, p.parent)) load(draft.features); } catch (e) { say(`Could not restore your patch: ${e.message}`); }
  } };
}
