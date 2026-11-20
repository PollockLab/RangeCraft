// Step bar: 1 Pick species, 2 Draw, 3 Propose. The current step follows state (no taxon, taxon, drawn geometry).
export function initSteps({ state, draw, $ }) {
  const items = [...document.querySelectorAll('#steps button')];
  let open = false, last; // open: user asked for the species block back (mobile collapses it after the pick)
  const go = [
    () => { open = true; render(); $('q').focus(); $('q').scrollIntoView({ block: 'center' }); },
    () => { const t = $('t-polygon'); if (!t.disabled) t.click(); },
    () => $('propose-card').scrollIntoView({ block: 'nearest' }),
  ];
  items.forEach((b, i) => b.addEventListener('click', go[i]));
  $('sp-change').addEventListener('click', go[0]);
  let cur = 0;
  const render = () => {
    const p = $('panel'); p.classList.toggle('sp-collapsed', cur > 0 && !open);
    $('sp-name').textContent = state.taxon?.name ?? '';
  };
  return () => {
    if (state.taxon?.key !== last) { last = state.taxon?.key; open = false; }
    cur = !state.taxon ? 0 : draw()?.all().length ? 2 : 1;
    items.forEach((b, i) => { b.parentElement.classList.toggle('done', i < cur); if (i === cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    render();
  };
}
