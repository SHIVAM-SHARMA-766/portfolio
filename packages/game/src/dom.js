// DOM binding for the game engine. Theme-agnostic: themes only mark up
// elements with data attributes, and this module wires them up.
//
//   <script type="application/json" id="game-config">  config (levels, achievements, rewards, pageIds, pageId)
//   [data-xp="15"][data-xp-id="project:dohra"]          award points on click (once per id)
//   [data-game-end]                                     sentinel; reaching it awards "read:<pageId>"
//   [data-game-xp] [data-game-level] [data-game-level-name] [data-game-next]   HUD text
//   [data-game-progress]                                gets --progress (0..1) and aria-valuenow
//   [data-game-achievements]                            list rendered with every achievement
//   [data-game-toggle]                                  turns the game layer on/off (recruiter mode)
//   [data-game-sound]                                   toggles sound
//   [data-game-reset]                                   wipes progress after confirm()
//   [data-game-coins]                                   spendable coins (XP minus purchases)
//   [data-shop-item="palette:x"] [data-price]           gets [data-locked] until owned; price filled in
//   [data-theme-lock="theme:quest"]                     shown when the visitor doesn't own that theme
//   [data-account-guest] / [data-account-user]          shown for guests / signed-in visitors
//   [data-account-name] [data-account-email] [data-account-avatar]
//   [data-login-providers]                              sign-in buttons for configured providers
//   [data-open-login] [data-open-shop]                  open #login-dialog / #shop-dialog
//   [data-shop-list]                                    shop items with buy buttons ([data-buy])
//   [data-account-logout] [data-account-delete]
//
// Exposes window.game for theme scripts (e.g. terminal commands).

import { createEngine, mergeStates } from './core.js';
import { createStorage, readPrefs, writePrefs } from './storage.js';
import { createAccount } from './account.js';
import { mountLive } from './live.js';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

function readConfig() {
  const el = document.getElementById('game-config');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

let audioCtx = null;
function beep(freq = 880, ms = 90) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.04;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch {
    /* audio is optional */
  }
}

function toastContainer() {
  let c = document.getElementById('g-toasts');
  if (!c) {
    c = document.createElement('div');
    c.id = 'g-toasts';
    c.className = 'g-toasts';
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
    document.body.appendChild(c);
  }
  return c;
}

export function toast(html, kind = 'xp') {
  if (document.documentElement.dataset.game === 'off') return;
  const t = document.createElement('div');
  t.className = `g-toast g-toast--${kind}`;
  t.innerHTML = html;
  toastContainer().appendChild(t);
  setTimeout(() => t.classList.add('g-toast--out'), kind === 'achievement' ? 3800 : 2200);
  setTimeout(() => t.remove(), kind === 'achievement' ? 4400 : 2800);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderAchievements(list, snap) {
  list.innerHTML = snap.achievements
    .map((a) => {
      const hidden = a.hidden && !a.unlocked;
      return `<li class="g-ach ${a.unlocked ? 'g-ach--on' : 'g-ach--off'}">
        <span class="g-ach__icon" aria-hidden="true">${hidden ? '❔' : esc(a.icon ?? '★')}</span>
        <span class="g-ach__text"><strong>${hidden ? 'Secret achievement' : esc(a.title)}</strong>
        <small>${hidden ? 'Keep exploring…' : esc(a.description)}${a.bonus ? ` · +${a.bonus} XP` : ''}</small></span>
        <span class="g-ach__state">${a.unlocked ? 'Unlocked' : 'Locked'}</span>
      </li>`;
    })
    .join('');
}

function render(snap) {
  const { xp, level } = snap;
  document.querySelectorAll('[data-game-xp]').forEach((el) => (el.textContent = String(xp)));
  document.querySelectorAll('[data-game-level]').forEach((el) => (el.textContent = String(level.number)));
  document.querySelectorAll('[data-game-level-name]').forEach((el) => (el.textContent = level.name));
  document.querySelectorAll('[data-game-next]').forEach((el) => {
    el.textContent = level.next ? `${level.next.xp - xp} XP to ${level.next.name}` : 'Max level reached';
  });
  document.querySelectorAll('[data-game-progress]').forEach((el) => {
    el.style.setProperty('--progress', String(level.progress));
    el.setAttribute('aria-valuenow', String(Math.round(level.progress * 100)));
  });
  document.querySelectorAll('[data-game-achievements]').forEach((el) => renderAchievements(el, snap));
  document.querySelectorAll('[data-game-ach-count]').forEach((el) => {
    el.textContent = `${snap.achievements.filter((a) => a.unlocked).length}/${snap.achievements.length}`;
  });
  renderAccount(xp);
}

let account = null;
const PROVIDER_LABEL = { google: 'Google', github: 'GitHub', linkedin: 'LinkedIn' };

function renderAccount(xp) {
  const a = account;
  const coins = a ? a.coins() : xp;
  document.querySelectorAll('[data-game-coins]').forEach((el) => (el.textContent = String(coins)));
  document.querySelectorAll('[data-shop-item]').forEach((el) => {
    const id = el.getAttribute('data-shop-item');
    const item = a?.item(id);
    const owned = a ? a.owns(id) : !item;
    el.toggleAttribute('data-locked', !owned);
    el.querySelectorAll('[data-price]').forEach((p) => (p.textContent = item && !owned ? `🪙 ${item.price}` : ''));
  });
  if (!a?.ready) return;
  document.querySelectorAll('[data-theme-lock]').forEach((el) => {
    el.hidden = a.owns(el.getAttribute('data-theme-lock'));
    el.querySelectorAll('[data-price]').forEach((p) => (p.textContent = String(a.item(el.getAttribute('data-theme-lock'))?.price ?? '')));
  });
  const u = a.user;
  document.querySelectorAll('[data-account-guest]').forEach((el) => (el.hidden = !!u));
  document.querySelectorAll('[data-account-user]').forEach((el) => (el.hidden = !u));
  document.querySelectorAll('[data-account-name]').forEach((el) => (el.textContent = u?.name || u?.email || ''));
  document.querySelectorAll('[data-account-email]').forEach((el) => (el.textContent = u?.email || ''));
  document.querySelectorAll('[data-account-avatar]').forEach((el) => {
    if (u?.avatar) { el.src = u.avatar; el.hidden = false; } else el.hidden = true;
  });
  document.querySelectorAll('[data-login-providers]').forEach((el) => {
    el.innerHTML = a.providers.length
      ? a.providers.map((p) => `<a class="g-login g-login--${p}" href="${esc(a.loginUrl(p))}">Continue with ${PROVIDER_LABEL[p] ?? p}</a>`).join('')
      : '<p class="g-muted">Sign-in is not available right now. Your progress is kept in this browser.</p>';
  });
  document.querySelectorAll('[data-shop-list]').forEach((el) => {
    el.innerHTML = a.shop.map((it) => {
      const owned = a.owns(it.id);
      return `<li class="g-shop-item ${owned ? 'is-owned' : ''}">
        <span><b>${esc(it.label)}</b>${it.description ? `<small>${esc(it.description)}</small>` : ''}</span>
        ${owned ? '<span class="g-owned">Owned ✓</span>' : `<button type="button" data-buy="${esc(it.id)}">🪙 ${it.price}</button>`}
      </li>`;
    }).join('');
  });
}

function openDialog(id) {
  const d = document.getElementById(id);
  if (d && !d.open) d.showModal();
}

async function buyItem(id) {
  if (!account) return;
  const it = account.item(id);
  if (!account.user) {
    toast(`🔒 <span><small>Sign in to unlock</small><b>${esc(it?.label ?? id)}</b></span>`, 'level');
    openDialog('login-dialog');
    return;
  }
  const r = await account.buy(id);
  if (r.ok) toast(`🎉 <span><small>Unlocked</small><b>${esc(it?.label ?? id)}</b></span>`, 'achievement');
  else if (r.reason === 'coins') toast(`🪙 <span><small>Not enough coins</small><b>Need ${it.price - account.coins()} more</b></span>`, 'level');
  else toast(`⚠️ <span><small>Could not buy</small><b>${esc(r.message ?? 'Try again')}</b></span>`, 'level');
}

export function mountGame() {
  if (window.game) return window.game;
  const config = readConfig();
  if (!config || config.enabled === false) return null;

  const storage = createStorage({ cookieDomain: config.cookieDomain });
  const prefs = readPrefs();
  let sound = prefs.sound === true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = new Set();

  const engine = createEngine({
    config,
    load: () => {
      const { local, shared } = storage.load();
      return mergeStates(local, shared);
    },
    save: (s) => storage.save(s),
    emit: (type, detail) => {
      if (type === 'award') account?.queue(detail.id, detail.points);
      if (type === 'award' && detail.points > 0) {
        toast(`<b>+${detail.points} XP</b> <span>${esc(detail.meta.label ?? '')}</span>`);
        if (sound) beep(880);
      }
      if (type === 'achievement') {
        const a = detail.achievement;
        toast(`<span class="g-toast__icon">${esc(a.icon ?? '★')}</span><span><small>Achievement unlocked</small><b>${esc(a.title)}</b></span>`, 'achievement');
        if (sound) { beep(660, 80); setTimeout(() => beep(990, 140), 90); }
      }
      if (type === 'level') {
        toast(`<span class="g-toast__icon">⬆️</span><span><small>Level ${detail.level.number}</small><b>${esc(detail.level.name)}</b></span>`, 'level');
        document.documentElement.classList.add('g-levelup');
        setTimeout(() => document.documentElement.classList.remove('g-levelup'), reduced ? 0 : 900);
      }
      if (type === 'change') render(detail);
      for (const fn of listeners) fn(type, detail);
    },
  });

  const rewards = config.rewards ?? {};

  // Clicks on anything with data-xp
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-xp]');
    if (!el) return;
    const id = el.getAttribute('data-xp-id');
    if (!id) return;
    engine.award(id, Number(el.getAttribute('data-xp')) || 0, { label: el.getAttribute('data-xp-label') ?? '' });
  });

  // Page visit
  if (config.pageId != null) {
    engine.award(`visit:${config.pageId}`, rewards.visit ?? 5, { label: 'New page discovered' });
  }

  // Read to the end
  const end = document.querySelector('[data-game-end]');
  if (end && config.pageId != null && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        engine.award(`read:${config.pageId}`, rewards.read ?? 5, { label: 'Read to the end' });
        io.disconnect();
      }
    });
    // Delay so a short page doesn't award instantly on load
    setTimeout(() => io.observe(end), 4000);
  }

  // Konami code
  let pos = 0;
  document.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    pos = k === KONAMI[pos] ? pos + 1 : k === KONAMI[0] ? 1 : 0;
    if (pos === KONAMI.length) {
      pos = 0;
      engine.award('secret:konami', 0, { label: 'Secret found' });
    }
  });

  // Toggles
  const applyOff = (off) => {
    document.documentElement.dataset.game = off ? 'off' : 'on';
    document.querySelectorAll('[data-game-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(!off));
      const label = b.querySelector('[data-label]') ?? b;
      label.textContent = off ? (b.dataset.onText ?? 'Play the game') : (b.dataset.offText ?? 'Skip the game');
    });
  };
  applyOff(prefs.gameOff === true);
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-game-toggle]')) {
      const off = document.documentElement.dataset.game !== 'off';
      writePrefs({ gameOff: off });
      applyOff(off);
    }
    if (e.target.closest?.('[data-game-sound]')) {
      sound = !sound;
      writePrefs({ sound });
      document.querySelectorAll('[data-game-sound]').forEach((b) => b.setAttribute('aria-pressed', String(sound)));
      if (sound) beep(880);
    }
    if (e.target.closest?.('[data-game-reset]')) {
      if (confirm('Reset all your points and achievements?')) engine.reset();
    }
  });
  document.querySelectorAll('[data-game-sound]').forEach((b) => b.setAttribute('aria-pressed', String(sound)));

  // Another tab earned something
  addEventListener('storage', (e) => {
    if (e.key === storage.key && e.newValue) {
      try { engine.absorb(JSON.parse(e.newValue)); } catch { /* ignore */ }
    }
  });

  account = config.apiUrl
    ? createAccount({ apiUrl: config.apiUrl, shop: config.shop ?? [], engine, onChange: () => render(engine.snapshot()) })
    : null;

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest?.('[data-open-login]')) openDialog('login-dialog');
    if (t.closest?.('[data-open-shop]')) openDialog('shop-dialog');
    const buy = t.closest?.('[data-buy]');
    if (buy) buyItem(buy.getAttribute('data-buy'));
    if (t.closest?.('[data-account-logout]')) account?.logout().then(() => toast('👋 <span><b>Signed out</b></span>', 'level'));
    if (t.closest?.('[data-account-delete]') && confirm('Delete your account and all saved progress? This cannot be undone.')) {
      account?.deleteAccount().then((ok) => toast(ok ? '🗑️ <span><b>Account deleted</b></span>' : '⚠️ <span><b>Could not delete</b></span>', 'level'));
    }
  });

  const loginResult = new URLSearchParams(location.search).get('login');
  if (loginResult) {
    const clean = new URL(location.href);
    clean.searchParams.delete('login');
    history.replaceState(null, '', clean);
  }

  render(engine.snapshot());
  if (config.apiUrl && config.live !== false) mountLive({ apiUrl: config.apiUrl });
  account?.init().then(() => {
    if (loginResult === 'ok' && account.user) toast(`✅ <span><small>Signed in as ${esc(account.user.name || account.user.email)}</small><b>Progress saved</b></span>`, 'achievement');
    if (loginResult === 'failed') toast('⚠️ <span><small>Sign-in failed</small><b>Please try again</b></span>', 'level');
  });

  const api = {
    award: engine.award,
    has: engine.has,
    snapshot: engine.snapshot,
    countPrefix: engine.countPrefix,
    reset: engine.reset,
    toast,
    rewards,
    get account() { return account; },
    buy: buyItem,
    openDialog,
    on: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  window.game = api;
  document.dispatchEvent(new CustomEvent('game:ready', { detail: api }));
  return api;
}
