// Step bar: 1 Pick species, 2 Draw, 3 Propose. The current step follows state (no taxon, taxon, drawn geometry).
export function initSteps({ state, draw, $ }) {
  const items = [...document.querySelectorAll('#steps button')];
  const go = [
    () => { $('q').focus(); $('q').scrollIntoView({ block: 'center' }); },
    () => { const t = $('t-polygon'); if (!t.disabled) t.click(); },
    () => $('propose-card').scrollIntoView({ block: 'nearest' }),
  ];
  items.forEach((b, i) => b.addEventListener('click', go[i]));
  return () => {
    const cur = !state.taxon ? 0 : draw()?.all().length ? 2 : 1;
    items.forEach((b, i) => { b.parentElement.classList.toggle('done', i < cur); if (i === cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  };
}
