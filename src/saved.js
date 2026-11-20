// How-it-works card and the contributor details saved in localStorage.
export function initSaved($) {
  if (localStorage.getItem('rc-how') === 'off') $('how').hidden = true;
  $('how-close').addEventListener('click', () => { $('how').hidden = true; localStorage.setItem('rc-how', 'off'); });
  const ME = ['author', 'github', 'orcid', 'inat'];
  try {
    const me = JSON.parse(localStorage.getItem('rc-me') || '{}');
    for (const k of ME) if (typeof me[k] === 'string') $(k).value = me[k];
    $('me').open = ME.slice(1).some(k => me[k]);
  } catch {}
  $('propose-form').addEventListener('input', e => { if (e.target.id === 'author') e.target.removeAttribute('aria-invalid'); try { localStorage.setItem('rc-me', JSON.stringify(Object.fromEntries(ME.map(k => [k, $(k).value])))); } catch {} });
}
