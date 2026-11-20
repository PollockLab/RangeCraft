import { suggest } from './api.js';

// Combobox over GBIF species suggest. onSelect({key, name}).
export function initSearch(input, list, onSelect) {
  let items = [], active = -1, timer, ctl;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const mark = () => [...list.children].forEach((li, i) => li.setAttribute('aria-selected', i === active));
  const pick = i => { const s = items[i]; if (!s) return; input.value = s.label; close(); onSelect({ key: s.key, name: s.label }); };

  function render() {
    list.replaceChildren(...items.map((s, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.textContent = s.vernacular ? `${s.label} (${s.vernacular})` : s.label;
      li.addEventListener('mousedown', e => { e.preventDefault(); pick(i); });
      return li;
    }));
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(items.length > 0));
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { items = []; render(); return; }
    timer = setTimeout(async () => {
      ctl?.abort(); ctl = new AbortController();
      try { items = await suggest(q, ctl.signal); render(); }
      catch (e) { if (e.name !== 'AbortError') { items = []; render(); } }
    }, 250);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      mark();
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', close);
}
