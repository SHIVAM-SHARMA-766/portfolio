// Live presence: how many people are on the site and on this page, plus the
// anonymous cursors of others on the same page. Positions are sent relative to
// the page's <main> element (x as a fraction of its width, y in px from its top)
// so they land on the same content even when window sizes differ.
//
//   [data-live]           text like "5 online · 2 here"
//   [data-live-cursors]   toggle button for showing/sending cursors
import { readPrefs, writePrefs } from './storage.js';

const ARROW = (c) => `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 1l13 7-6 1.5L6.5 16z" fill="${c}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

export function mountLive({ apiUrl }) {
  if (!apiUrl || !('WebSocket' in window)) return null;
  const wsUrl = apiUrl.replace(/^http/, 'ws') + '/live';
  const finePointer = matchMedia('(pointer: fine)').matches;
  let enabled = readPrefs().cursors !== false;
  let ws = null;
  let retry = 1000;
  let lastSend = 0;
  const cursors = new Map(); // id → { el, seen }

  const layer = document.createElement('div');
  layer.className = 'g-cursors';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  const anchor = () => document.querySelector('main') ?? document.body;
  const frame = () => {
    const r = anchor().getBoundingClientRect();
    return { left: r.left + scrollX, top: r.top + scrollY, width: r.width || 1 };
  };

  const setCount = (site, page) => {
    document.querySelectorAll('[data-live]').forEach((el) => {
      el.removeAttribute('data-offline');
      el.textContent = `${site} online`;
      el.title = `${site} people on the site right now${page > 1 ? `, ${page} on this page` : ''}`;
    });
  };
  const setOffline = () => document.querySelectorAll('[data-live]').forEach((el) => { el.setAttribute('data-offline', ''); el.textContent = 'offline'; });

  const markToggle = () => document.querySelectorAll('[data-live-cursors]').forEach((b) => {
    b.setAttribute('aria-pressed', String(enabled));
    const label = b.querySelector('[data-label]') ?? b;
    label.textContent = enabled ? 'Hide cursors' : 'Show cursors';
  });

  const removeCursor = (id) => { cursors.get(id)?.el.remove(); cursors.delete(id); };
  const clearCursors = () => { for (const id of [...cursors.keys()]) removeCursor(id); };

  const send = (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
  const join = () => send({ t: 'join', path: location.pathname });

  function connect() {
    try { ws = new WebSocket(wsUrl); } catch { return; }
    ws.onopen = () => { retry = 1000; join(); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'count') setCount(m.site, m.page);
      if (m.t === 'leave') removeCursor(m.id);
      if (m.t === 'cursor' && enabled && finePointer) {
        let c = cursors.get(m.id);
        if (!c) {
          const el = document.createElement('div');
          el.className = 'g-cursor';
          el.innerHTML = ARROW(m.color);
          layer.appendChild(el);
          c = { el };
          cursors.set(m.id, c);
        }
        c.seen = Date.now();
        const f = frame();
        c.el.style.transform = `translate(${f.left + m.x * f.width}px, ${f.top + m.y}px)`;
      }
    };
    ws.onclose = () => {
      setOffline();
      clearCursors();
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  }

  if (finePointer) {
    addEventListener('pointermove', (e) => {
      if (!enabled || e.pointerType !== 'mouse') return;
      const now = performance.now();
      if (now - lastSend < 60) return;
      lastSend = now;
      const f = frame();
      send({ t: 'move', x: +((e.pageX - f.left) / f.width).toFixed(4), y: Math.round(e.pageY - f.top) });
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => send({ t: 'hide' }));
  }

  // Forget cursors that stopped moving.
  setInterval(() => { for (const [id, c] of cursors) if (Date.now() - c.seen > 15000) removeCursor(id); }, 5000);

  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('[data-live-cursors]')) return;
    enabled = !enabled;
    writePrefs({ cursors: enabled });
    if (!enabled) { clearCursors(); send({ t: 'hide' }); }
    markToggle();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) send({ t: 'hide' }); });

  markToggle();
  connect();
  return { join };
}
