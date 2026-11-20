// Who is proposing: the relay session when signed in (identity fields hidden), else the form fields. Returns { author, github, orcid, inat } or { err, field }.
import { ORCID_RE, INAT_RE, GITHUB_RE } from './export.js';

export function readWho($, s, needName) {
  $('author-field').hidden = $('me').hidden = !!s; // a session that expired since page load shows the fields again
  if (s) return { author: s.name, github: '', orcid: '', inat: '' };
  const author = $('author').value.trim(), github = $('github').value.trim(), orcid = $('orcid').value.trim(), inat = $('inat').value.trim();
  if (needName && !author) return { err: 'Enter a display name.', field: 'author' };
  if (github && !GITHUB_RE.test(github)) return { err: 'GitHub username: letters, digits, hyphens, up to 39.', field: 'github' };
  if (orcid && !ORCID_RE.test(orcid)) return { err: 'ORCID must look like 0000-0002-1825-0097.', field: 'orcid' };
  if (inat && !INAT_RE.test(inat)) return { err: 'iNaturalist username: letters, digits, _ or -.', field: 'inat' };
  return { author, github, orcid, inat };
}
