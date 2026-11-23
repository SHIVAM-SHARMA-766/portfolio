// DOM binding for the game engine. Theme-agnostic: themes only mark up
// elements with data attributes, and this module wires them up.
//
//   <script type="application/json" id="game-config">  config (levels, achievements, rewards, pageIds, pageId,
//                                                       theme, themes, palettes, shop, apiUrl, siteUrl)
//   [data-xp="15"][data-xp-id="project:dohra"]          award points on click (once per id)
//   [data-game-end]                                     sentinel; reaching it awards "read:<pageId>"
//   [data-game-xp] [data-game-level] [data-game-level-name] [data-game-next]   HUD text
//   [data-game-progress]                                gets --progress (0..1) and aria-valuenow
//   [data-game-achievements] [data-game-ach-count]      achievements list / "3/16"
//   [data-game-toggle] [data-game-sound] [data-game-reset]
//   [data-game-coins]                                   spendable coins (XP minus purchases)
//   [data-shop-item="palette:x"] [data-price]           gets [data-locked] until owned; price filled in
//   [data-palette-btn="id"]                             applies a palette, or opens the shop if locked
//   [data-theme-lock="theme:quest"]                     overlay shown after the free preview of a locked theme
//   [data-preview-bar="theme:quest"] [data-preview-left] banner during the free preview
//   [data-buy-slot="item"]                              filled with the right buy button for that item
//   [data-shop]                                         the shop, grouped by theme
//   [data-account-guest] / [data-account-user]          shown for guests / signed-in visitors
//   [data-account-name] [data-account-email] [data-account-avatar]
//   [data-login-providers]                              sign-in buttons for configured providers
//   [data-open-login] [data-open-shop="item?"]          open #login-dialog / #shop-dialog (focused on an item)
//   [data-account-logout] [data-account-delete]
//
// Exposes window.game for theme scripts (e.g. terminal commands).

import { createEngine, mergeStates } from './core.js';
import { createStorage, readPrefs, writePrefs } from './storage.js';
import { createAccount } from './account.js';
import { mountLive } from './live.js';
import { shopView } from './shop.js';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const PREVIEW_SECONDS = 90;
const MAX_TOASTS = 3;
const PROVIDER_LABEL = { google: 'Google', github: 'GitHub', linkedin: 'LinkedIn' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $$ = (sel) => document.querySelectorAll(sel);
// Replace markup only when it changed: re-creating a button between pointerdown
// and click would swallow the click (every click re-renders, since clicks earn points).
const setHTML = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };

function readConfig() {
  const el = document.getElementById('game-config');
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch { return null; }
}

// ---- sound -------------------------------------------------------------------

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
  } catch { /* audio is optional */ }
}

// ---- toasts --------------------------------------------------------------------
// Small XP awards that arrive close together merge into one toast, and at most
// three toasts are on screen, so exploring quickly doesn't bury the page.

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

function dismissLater(t, ms) {
  clearTimeout(t._out); clearTimeout(t._rm);
  t._out = setTimeout(() => t.classList.add('g-toast--out'), ms);
  t._rm = setTimeout(() => t.remove(), ms + 500);
}

// Until a first-time visitor answers the welcome card, game toasts wait: the
// card is the one thing to read. XP toasts are dropped (the HUD shows the
// total), achievements are shown once the card is gone.
const heldToasts = [];
const holdingToasts = () => document.documentElement.dataset.game !== 'off' && config.pageId != null && !readPrefs().welcomed;
function releaseToasts() {
  heldToasts.splice(0).slice(-2).forEach(([html, kind], i) => setTimeout(() => toast(html, kind), 300 + i * 500));
}

export function toast(html, kind = 'xp') {
  if (document.documentElement.dataset.game === 'off' && kind !== 'notice') return null;
  if (kind !== 'notice' && holdingToasts()) { if (kind !== 'xp') heldToasts.push([html, kind]); return null; }
  const c = toastContainer();
  while (c.children.length >= MAX_TOASTS) c.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = `g-toast g-toast--${kind}`;
  t.innerHTML = html;
  c.appendChild(t);
  dismissLater(t, kind === 'achievement' || kind === 'notice' ? 4200 : 2400);
  return t;
}

const xpToast = { el: null, sum: 0, n: 0, label: '' };
function showXp(points, label) {
  const live = xpToast.el?.isConnected && !xpToast.el.classList.contains('g-toast--out');
  if (live) {
    xpToast.sum += points; xpToast.n += 1; xpToast.label = label || xpToast.label;
    xpToast.el.innerHTML = `<b>+${xpToast.sum} XP</b> <span>${esc(xpToast.label)}${xpToast.n > 1 ? ` <i class="g-toast__meta">· ${xpToast.n} actions</i>` : ''}</span>`;
    dismissLater(xpToast.el, 2400);
    return;
  }
  Object.assign(xpToast, { sum: points, n: 1, label });
  xpToast.el = toast(`<b>+${points} XP</b> <span>${esc(label)}</span>`);
}

// ---- click feedback ---------------------------------------------------------------

function ripple(x, y, reduced) {
  if (reduced) return;
  const r = document.createElement('span');
  r.className = 'g-ripple';
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  r.setAttribute('aria-hidden', 'true');
  document.body.appendChild(r);
  setTimeout(() => r.remove(), 650);
}

function floatText(x, y, text, reduced) {
  const f = document.createElement('span');
  f.className = `g-plus ${reduced ? 'g-plus--still' : ''}`;
  f.textContent = text;
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  f.setAttribute('aria-hidden', 'true');
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 900);
}

// ---- rendering -------------------------------------------------------------------

let config = null;
let account = null;
let engineRef = null;
let pendingBuy = null; // item id awaiting confirmation
let pendingTimer = null;
let focusItem = null;  // shop item to highlight

function renderAchievements(list, snap) {
  setHTML(list, snap.achievements.map((a) => {
    const hidden = a.hidden && !a.unlocked;
    return `<li class="g-ach ${a.unlocked ? 'g-ach--on' : 'g-ach--off'}">
      <span class="g-ach__icon" aria-hidden="true">${hidden ? '❔' : esc(a.icon ?? '★')}</span>
      <span class="g-ach__text"><strong>${hidden ? 'Secret achievement' : esc(a.title)}</strong>
      <small>${hidden ? 'Keep exploring…' : esc(a.description)}${a.bonus ? ` · +${a.bonus} XP` : ''}</small></span>
      <span class="g-ach__state">${a.unlocked ? 'Unlocked' : 'Locked'}</span>
    </li>`;
  }).join(''));
}

function render(snap) {
  const { xp, level } = snap;
  $$('[data-game-xp]').forEach((el) => (el.textContent = String(xp)));
  $$('[data-game-level]').forEach((el) => (el.textContent = String(level.number)));
  $$('[data-game-level-name]').forEach((el) => (el.textContent = level.name));
  $$('[data-game-next]').forEach((el) => (el.textContent = level.next ? `${level.next.xp - xp} XP to ${level.next.name}` : 'Max level reached'));
  $$('[data-game-progress]').forEach((el) => {
    el.style.setProperty('--progress', String(level.progress));
    el.setAttribute('aria-valuenow', String(Math.round(level.progress * 100)));
  });
  $$('[data-game-achievements]').forEach((el) => renderAchievements(el, snap));
  $$('[data-game-ach-count]').forEach((el) => (el.textContent = `${snap.achievements.filter((a) => a.unlocked).length}/${snap.achievements.length}`));
  renderAccount(xp);
}

const owns = (id) => (account ? account.owns(id) : !config?.shop?.some((i) => i.id === id && i.price > 0));
const itemOf = (id) => account?.item(id) ?? config?.shop?.find((i) => i.id === id);
const currentPalette = () => document.documentElement.dataset.palette;

/** The button for an item, reflecting exactly what the visitor can do. */
function buyButton(id, { compact = false } = {}) {
  const it = itemOf(id);
  if (!it) return '';
  if (owns(id)) return compact ? '' : '<span class="g-chip g-chip--ok">Owned</span>';
  const can = account?.canBuy(id) ?? { ok: false, reason: 'login' };
  if (can.reason === 'requires') return `<button type="button" class="g-btn" disabled title="Unlock ${esc(can.requires?.label ?? 'the theme')} first">🔒 ${esc(can.requires?.label?.replace(/ theme$/i, '') ?? 'Theme')} first</button>`;
  if (can.reason === 'login') return `<button type="button" class="g-btn g-btn--primary" data-open-login>Sign in to unlock · 🪙 ${it.price}</button>`;
  if (can.reason === 'coins') return `<button type="button" class="g-btn" disabled>🪙 ${it.price} · need ${can.short} more</button>`;
  if (pendingBuy === id) return `<button type="button" class="g-btn g-btn--confirm" data-buy="${esc(id)}">Confirm · ${can.left} left</button>`;
  return `<button type="button" class="g-btn g-btn--primary" data-buy="${esc(id)}">Unlock · 🪙 ${it.price}</button>`;
}

function themeHref(theme) {
  if (config.theme) return `?theme=${theme}`;
  return `${(config.siteUrl ?? '').replace(/\/$/, '')}/?theme=${theme}`;
}

function renderShop(el) {
  const groups = shopView(account?.shop ?? config.shop ?? [], config.palettes ?? {}, config.themes ?? []);
  const coins = account ? account.coins() : engineRef.snapshot().xp;
  const guest = !account?.user;
  setHTML(el, `
    <div class="g-shop-head">
      <span class="g-coins">🪙 <b>${coins}</b> coins</span>
      <small>Every XP point you earn is a coin. Unlocking things never lowers your level.</small>
    </div>
    ${guest ? `<div class="g-shop-note">Sign in to unlock things and keep them on every device. <button type="button" class="g-btn g-btn--primary" data-open-login>Sign in</button></div>` : ''}
    ${groups.map((g) => {
      const themeId = `theme:${g.theme}`;
      const themeOwned = owns(themeId);
      const using = config.theme === g.theme;
      const c = g.palettes[0]?.colors ?? {};
      const chip = using ? '<span class="g-chip g-chip--ok">In use</span>' : themeOwned ? `<span class="g-chip">${g.item ? 'Owned' : 'Free'}</span>` : `<span class="g-chip g-chip--price">🪙 ${g.item.price}</span>`;
      const action = themeOwned
        ? (using ? '' : `<a class="g-btn" href="${esc(themeHref(g.theme))}">Switch to ${esc(g.label)}</a>`)
        : `${buyButton(themeId)} <a class="g-btn g-btn--ghost" href="${esc(themeHref(g.theme))}">Preview</a>`;
      return `<section class="g-shop-theme ${focusItem === themeId ? 'is-focus' : ''}" data-shop-entry="${esc(themeId)}">
        <div class="g-shop-theme__head">
          <span class="g-shop-preview" aria-hidden="true" style="--p-bg:${c.bg};--p-surface:${c.surface};--p-fg:${c.fg};--p-accent:${c.accent};--p-accent2:${c.accent2}"><i></i><i></i><i></i></span>
          <div class="g-shop-theme__text"><h3>${esc(g.label)} ${chip}</h3><p>${esc(g.item?.description || g.blurb)}</p></div>
          <div class="g-shop-actions">${action}</div>
        </div>
        <ul class="g-pals">${g.palettes.map((p) => {
          const pid = `palette:${g.theme}-${p.id}`;
          const owned = owns(pid);
          const isCurrent = using && currentPalette() === p.id;
          const blocked = !themeOwned;
          let state, act = '';
          if (isCurrent) state = '<span class="g-chip g-chip--ok">In use</span>';
          else if (owned && !blocked) { state = p.item ? 'Owned' : 'Free'; if (using) act = `<button type="button" class="g-btn g-btn--small" data-apply-palette="${esc(p.id)}">Use</button>`; }
          else if (owned && blocked) state = `Free with ${esc(g.label)}`;
          else { state = blocked ? `🔒 needs ${esc(g.label)}` : `🪙 ${p.item.price}`; act = blocked ? '' : buyButton(pid, { compact: true }); }
          return `<li class="g-pal ${isCurrent ? 'is-current' : ''} ${owned && !blocked ? 'is-owned' : ''} ${!owned || blocked ? 'is-locked' : ''} ${focusItem === pid ? 'is-focus' : ''}" data-shop-entry="${esc(pid)}">
            <span class="g-pal__swatch" aria-hidden="true" style="--s-bg:${p.colors.bg};--s-accent:${p.colors.accent};--s-accent2:${p.colors.accent2}"></span>
            <span class="g-pal__name">${esc(p.label)}<small>${state}</small></span>
            <span class="g-pal__act">${act}</span>
          </li>`;
        }).join('')}</ul>
      </section>`;
    }).join('')}`);
}

function renderAccount(xp) {
  const a = account;
  const coins = a ? a.coins() : xp;
  $$('[data-game-coins]').forEach((el) => (el.textContent = String(coins)));
  $$('[data-shop-item]').forEach((el) => {
    const id = el.getAttribute('data-shop-item');
    const it = itemOf(id);
    const owned = owns(id);
    el.toggleAttribute('data-locked', !owned);
    const blocked = it?.requires && !owns(it.requires);
    el.querySelectorAll('[data-price]').forEach((p) => (p.textContent = owned || !it ? '' : blocked ? '🔒' : `🪙 ${it.price}`));
    if (!owned && it) el.title = blocked ? `${it.label} — unlock ${itemOf(it.requires)?.label ?? 'its theme'} first` : `${it.label} — 🪙 ${it.price}`;
  });
  $$('[data-buy-slot]').forEach((el) => setHTML(el, buyButton(el.getAttribute('data-buy-slot'))));
  $$('[data-palette-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.paletteBtn === currentPalette())));
  const shopDialog = document.getElementById('shop-dialog');
  if (shopDialog?.open) $$('[data-shop]').forEach(renderShop);
  if (!a?.ready) return;
  updateThemeLock();
  const u = a.user;
  $$('[data-account-guest]').forEach((el) => (el.hidden = !!u));
  $$('[data-account-user]').forEach((el) => (el.hidden = !u));
  $$('[data-account-name]').forEach((el) => (el.textContent = u?.name || u?.email || ''));
  $$('[data-account-email]').forEach((el) => (el.textContent = u?.email || ''));
  $$('[data-account-avatar]').forEach((el) => { if (u?.avatar) { el.src = u.avatar; el.hidden = false; } else el.hidden = true; });
  $$('[data-login-providers]').forEach((el) => {
    setHTML(el, a.providers.length
      ? a.providers.map((p) => `<a class="g-login g-login--${p}" href="${esc(a.loginUrl(p))}">Continue with ${PROVIDER_LABEL[p] ?? p}</a>`).join('')
      : '<p class="g-muted">Sign-in is not available right now. Your progress is kept in this browser.</p>');
  });
}

// ---- locked themes: free preview, then the unlock screen ---------------------------

let previewTimer = null;
function updateThemeLock() {
  $$('[data-theme-lock]').forEach((overlay) => {
    const id = overlay.getAttribute('data-theme-lock');
    const bar = document.querySelector(`[data-preview-bar="${id}"]`);
    if (owns(id)) { overlay.hidden = true; if (bar) bar.hidden = true; document.body.classList.remove('g-has-bar'); clearInterval(previewTimer); return; }
    const key = `pf.preview.${id}`;
    let start = Date.now();
    try { start = Number(sessionStorage.getItem(key)) || start; sessionStorage.setItem(key, String(start)); } catch {}
    const tick = () => {
      const left = Math.max(0, PREVIEW_SECONDS - Math.floor((Date.now() - start) / 1000));
      if (bar) {
        bar.hidden = left <= 0;
        document.body.classList.toggle('g-has-bar', !bar.hidden); // lifts toasts above the bar
        bar.querySelectorAll('[data-preview-left]').forEach((el) => (el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`));
      }
      overlay.hidden = left > 0;
      if (left <= 0) clearInterval(previewTimer);
    };
    tick();
    clearInterval(previewTimer);
    if (!overlay.hidden) return;
    previewTimer = setInterval(tick, 1000);
  });
}

// ---- dialogs, shop and purchases ------------------------------------------------------

function openDialog(id) {
  const d = document.getElementById(id);
  if (d && !d.open) d.showModal();
}

function openShop(itemId = null) {
  focusItem = itemId;
  pendingBuy = null;
  $$('[data-shop]').forEach(renderShop);
  openDialog('shop-dialog');
  if (itemId) requestAnimationFrame(() => document.querySelector(`#shop-dialog [data-shop-entry="${CSS.escape(itemId)}"]`)?.scrollIntoView({ block: 'center' }));
}

function applyPalette(theme, id, { award = true } = {}) {
  if (!theme) return;
  document.documentElement.dataset.palette = id;
  const prefs = readPrefs();
  writePrefs({ palettes: { ...(prefs.palettes ?? {}), [theme]: id } });
  if (award) engineRef?.award(`palette:${theme}-${id}`, config.rewards?.palette ?? 5, { label: 'New palette' });
  render(engineRef.snapshot());
}

async function buyItem(id) {
  if (!account) return;
  const it = account.item(id);
  const can = account.canBuy(id);
  if (!can.ok) {
    if (can.reason === 'login') return openDialog('login-dialog');
    return openShop(id);
  }
  if (pendingBuy !== id) { // first click asks for confirmation
    pendingBuy = id;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingBuy = null; render(engineRef.snapshot()); }, 5000);
    render(engineRef.snapshot());
    return;
  }
  pendingBuy = null;
  const r = await account.buy(id);
  if (!r.ok) {
    toast(`⚠️ <span><small>Could not unlock</small><b>${esc(r.message ?? 'Please try again')}</b></span>`, 'notice');
    return;
  }
  if (it.kind === 'palette' && it.theme === config.theme) {
    applyPalette(it.theme, it.palette);
    toast(`🎨 <span><small>Unlocked and applied</small><b>${esc(it.label)}</b></span>`, 'achievement');
  } else if (it.kind === 'theme' && it.theme === config.theme) {
    toast(`🎉 <span><small>Unlocked</small><b>${esc(it.label)}</b> — it's yours now</span>`, 'achievement');
  } else {
    toast(`🎉 <span><small>Unlocked</small><b>${esc(it.label)}</b></span>`, 'achievement');
  }
  focusItem = id;
  render(engineRef.snapshot());
}

// ---- first visit -------------------------------------------------------------------------

function welcome() {
  const prefs = readPrefs();
  if (prefs.welcomed || document.documentElement.dataset.game === 'off' || config.pageId == null) return;
  setTimeout(() => {
    const card = document.createElement('div');
    card.className = 'g-welcome';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'How this site works');
    card.innerHTML = `<b>This portfolio is a game 🎮</b>
      <p>Explore to earn XP and coins: open projects, read pages${config.theme === 'terminal' ? ', try the terminal' : ''}. Spend coins in the shop to unlock themes and colours.</p>
      <div class="g-welcome__actions"><button type="button" class="g-btn g-btn--primary" data-welcome="play">Let's go</button><button type="button" class="g-btn g-btn--ghost" data-welcome="skip">Just show me the portfolio</button></div>`;
    document.body.appendChild(card);
    card.addEventListener('click', (e) => {
      const choice = e.target.closest('[data-welcome]')?.dataset.welcome;
      if (!choice) return;
      writePrefs({ welcomed: true });
      card.remove();
      if (choice === 'skip') { heldToasts.length = 0; document.querySelector('[data-game-toggle]')?.click(); }
      else releaseToasts();
    });
  }, 600);
}

// ---- mount ---------------------------------------------------------------------------------

export function mountGame() {
  if (window.game) return window.game;
  config = readConfig();
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
      if (type === 'award' && detail.points > 0 && !detail.meta.silent) {
        showXp(detail.points, detail.meta.label ?? '');
        if (sound) beep(880);
      }
      if (type === 'achievement') {
        const a = detail.achievement;
        toast(`<span class="g-toast__icon">${esc(a.icon ?? '★')}</span><span><small>Achievement unlocked</small><b>${esc(a.title)}</b></span>`, 'achievement');
        if (sound) { beep(660, 80); setTimeout(() => beep(990, 140), 90); }
      }
      if (type === 'level') {
        toast(`<span class="g-toast__icon">⬆️</span><span><small>Level ${detail.level.number}</small><b>${esc(detail.level.name)}</b></span>`, 'achievement');
        document.documentElement.classList.add('g-levelup');
        setTimeout(() => document.documentElement.classList.remove('g-levelup'), reduced ? 0 : 900);
      }
      if (type === 'change') render(detail);
      for (const fn of listeners) fn(type, detail);
    },
  });
  engineRef = engine;
  const rewards = config.rewards ?? {};

  // Awards for clicks, visits, reading to the end, and the Konami code
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-xp]');
    const id = el?.getAttribute('data-xp-id');
    if (id) engine.award(id, Number(el.getAttribute('data-xp')) || 0, { label: el.getAttribute('data-xp-label') ?? '' });
  });
  if (config.pageId != null) engine.award(`visit:${config.pageId}`, rewards.visit ?? 5, { label: 'New page discovered' });
  const end = document.querySelector('[data-game-end]');
  if (end && config.pageId != null && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { engine.award(`read:${config.pageId}`, rewards.read ?? 5, { label: 'Read to the end' }); io.disconnect(); }
    });
    setTimeout(() => io.observe(end), 4000); // a short page shouldn't award instantly
  }
  let pos = 0;
  document.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    pos = k === KONAMI[pos] ? pos + 1 : k === KONAMI[0] ? 1 : 0;
    if (pos === KONAMI.length) { pos = 0; engine.award('secret:konami', 0, { label: 'Secret found' }); }
  });

  // Every click ripples; the first clickCap clicks are worth a point each.
  // The ripple starts on pointerdown (instant feedback, no re-render). The point is
  // awarded on click: by then the browser has picked the click target, so the
  // re-render that the new coin total causes can't swallow the click.
  const clickable = (e) => e.button === 0 && document.documentElement.dataset.game !== 'off'
    && !e.target.closest?.('input, textarea, select, [contenteditable="true"], .g-welcome');
  document.addEventListener('pointerdown', (e) => { if (clickable(e)) ripple(e.clientX, e.clientY, reduced); }, { passive: true });
  let lastClickAward = 0;
  document.addEventListener('click', (e) => {
    if (!clickable(e) || !e.isTrusted) return;
    const cap = config.clickCap ?? 0;
    const n = engine.countPrefix('click:');
    const now = performance.now();
    if (n >= cap || now - lastClickAward < 300) return; // capped, and no auto-clicker farming
    lastClickAward = now;
    const pts = rewards.click ?? 1;
    if (engine.award(`click:${n + 1}`, pts, { label: 'Click', silent: true })) floatText(e.clientX, e.clientY, `+${pts}`, reduced);
  }, { passive: true });

  // Game on/off, sound, reset
  const applyOff = (off) => {
    document.documentElement.dataset.game = off ? 'off' : 'on';
    $$('[data-game-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(!off));
      const label = b.querySelector('[data-label]') ?? b;
      label.textContent = off ? (b.dataset.onText ?? 'Play the game') : (b.dataset.offText ?? 'Skip the game');
    });
  };
  applyOff(prefs.gameOff === true);
  $$('[data-game-sound]').forEach((b) => b.setAttribute('aria-pressed', String(sound)));

  account = config.apiUrl
    ? createAccount({ apiUrl: config.apiUrl, shop: config.shop ?? [], engine, onChange: () => render(engine.snapshot()) })
    : null;

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest?.('[data-game-toggle]')) {
      const off = document.documentElement.dataset.game !== 'off';
      writePrefs({ gameOff: off });
      applyOff(off);
    }
    if (t.closest?.('[data-game-sound]')) {
      sound = !sound;
      writePrefs({ sound });
      $$('[data-game-sound]').forEach((b) => b.setAttribute('aria-pressed', String(sound)));
      if (sound) beep(880);
    }
    if (t.closest?.('[data-game-reset]') && confirm('Reset all your points and achievements?')) engine.reset();
    if (t.closest?.('[data-open-login]')) { document.getElementById('shop-dialog')?.close(); openDialog('login-dialog'); }
    const shopBtn = t.closest?.('[data-open-shop]');
    if (shopBtn) { document.getElementById('login-dialog')?.close(); openShop(shopBtn.getAttribute('data-open-shop') || null); }
    const buy = t.closest?.('[data-buy]');
    if (buy) buyItem(buy.getAttribute('data-buy'));
    const use = t.closest?.('[data-apply-palette]');
    if (use) applyPalette(config.theme, use.getAttribute('data-apply-palette'));
    // Palette switcher: apply, or open the shop at that palette when it's locked
    const pal = t.closest?.('[data-palette-btn]');
    if (pal) {
      if (pal.hasAttribute('data-locked')) openShop(pal.dataset.shopItem);
      else applyPalette(config.theme, pal.dataset.paletteBtn);
    }
    // A locked theme in the switcher opens the shop instead of a locked page
    const themeLink = t.closest?.('a[data-shop-item^="theme:"][data-locked]');
    if (themeLink && !e.defaultPrevented) { e.preventDefault(); openShop(themeLink.dataset.shopItem); }
    if (t.closest?.('[data-account-logout]')) account?.logout().then(() => toast('👋 <span><b>Signed out</b></span>', 'notice'));
    if (t.closest?.('[data-account-delete]') && confirm('Delete your account and all saved progress? This cannot be undone.')) {
      account?.deleteAccount().then((ok) => toast(ok ? '🗑️ <span><b>Account deleted</b></span>' : '⚠️ <span><b>Could not delete</b></span>', 'notice'));
    }
  });

  // Another tab earned something
  addEventListener('storage', (e) => {
    if (e.key === storage.key && e.newValue) { try { engine.absorb(JSON.parse(e.newValue)); } catch { /* ignore */ } }
  });

  const loginResult = new URLSearchParams(location.search).get('login');
  if (loginResult) {
    const clean = new URL(location.href);
    clean.searchParams.delete('login');
    history.replaceState(null, '', clean);
  }

  render(engine.snapshot());
  if (config.apiUrl && config.live !== false) mountLive({ apiUrl: config.apiUrl });
  const ready = account
    ? account.init().then(() => {
        if (loginResult === 'ok' && account.user) toast(`✅ <span><small>Signed in as ${esc(account.user.name || account.user.email)}</small><b>Your progress is saved</b></span>`, 'notice');
        if (loginResult === 'failed') toast('⚠️ <span><small>Sign-in failed</small><b>Please try again</b></span>', 'notice');
      })
    : Promise.resolve().then(updateThemeLock);
  ready.then(welcome);

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
    openShop,
    openDialog,
    applyPalette: (id) => applyPalette(config.theme, id),
    on: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  window.game = api;
  document.dispatchEvent(new CustomEvent('game:ready', { detail: api }));
  return api;
}
