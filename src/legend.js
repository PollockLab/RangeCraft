// Map legend control. Returns update(items), items = [{ label, swatch | dashed | palette }]; empty hides it.
export function initLegend(map) {
  const box = document.createElement('div');
  box.id = 'legend';
  box.className = 'maplibregl-ctrl';
  box.hidden = true;
  map.addControl({ onAdd: () => box, onRemove: () => box.remove() }, 'bottom-left');
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'lg-toggle', textContent: 'Legend' }); // shown on narrow screens only (style.css)
  btn.setAttribute('aria-expanded', 'false');
  btn.onclick = () => btn.setAttribute('aria-expanded', box.classList.toggle('open'));
  const sw = (bg, cls = 'sw') => Object.assign(document.createElement('i'), { className: cls, style: bg ? `background:${bg}` : '' });
  return items => {
    box.hidden = !items.length;
    box.replaceChildren(btn, ...items.map(({ label, swatch, dashed, palette, title }) => {
      const row = document.createElement('div');
      row.append(...(palette ? palette.map(c => sw(c)) : [dashed ? sw('', 'sw dashed') : sw(swatch)]), ` ${label}`);
      if (title) row.title = title;
      return row;
    }));
  };
}
