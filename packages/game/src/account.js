// Visitor accounts: sign-in, saved progress and the coin shop.
//
// Guests play with progress in the browser only. After signing in, everything
// earned as a guest is sent to the API, which keeps only events from its
// catalog at the catalog's value, and the server's state is merged back. From
// then on every award is synced in small batches. If the API is unreachable the
// site keeps working in guest mode.
//
// Coins = XP − price of owned items. Spending coins never lowers XP or level.

import { normalizeShop } from './shop.js';

export function createAccount({ apiUrl, shop = [], engine, onChange = () => {} }) {
  let items = new Map(normalizeShop(shop).map((i) => [i.id, i]));
  let user = null;
  let providers = [];
  let purchases = {};
  let ready = false;
  let queue = {};
  let timer = null;

  const api = async (path, opts = {}) => {
    const res = await fetch(`${apiUrl}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  };

  const applyServer = (state) => {
    if (!state) return;
    purchases = state.purchases ?? {};
    const ach = {};
    for (const [id, on] of Object.entries(state.achievements ?? {})) if (on) ach[id] = 1;
    engine.absorb({ events: state.events ?? {}, ach });
  };

  const spent = () => Object.values(purchases).reduce((a, b) => a + b, 0);

  async function flush() {
    timer = null;
    if (!user || !Object.keys(queue).length) return;
    const batch = queue;
    queue = {};
    try {
      const r = await api('/events', { method: 'POST', body: JSON.stringify({ events: batch }) });
      if (r.ok) applyServer(r.body.state);
      else if (r.status !== 401) Object.assign(queue, batch);
    } catch {
      Object.assign(queue, batch); // retry on the next award
    }
    onChange();
  }

  return {
    async init() {
      try {
        const r = await api('/me');
        providers = r.body.providers ?? [];
        if (r.body.shop?.length) items = new Map(normalizeShop(r.body.shop).map((i) => [i.id, i]));
        user = r.body.user ?? null;
        if (user) {
          applyServer(r.body.state);
          queue = { ...engine.snapshot().events };
          await flush();
        }
      } catch {
        user = null;
      }
      ready = true;
      onChange();
    },
    /** Called by the engine for every new award. */
    queue(id, points) {
      if (!user) return;
      queue[id] = points;
      clearTimeout(timer);
      timer = setTimeout(flush, 1200);
    },
    get ready() { return ready; },
    get user() { return user; },
    get providers() { return providers; },
    get shop() { return [...items.values()]; },
    item: (id) => items.get(id),
    /** Free things (not in the shop, or price 0) are always owned. */
    owns(id) {
      const it = items.get(id);
      return !it || it.price <= 0 || id in purchases;
    },
    coins() { return engine.snapshot().xp - spent(); },
    /**
     * Whether an item can be bought right now, and if not, why:
     * 'owned' | 'requires' (needs another item first) | 'login' | 'coins'.
     */
    canBuy(id) {
      const it = items.get(id);
      if (!it || this.owns(id)) return { ok: false, reason: 'owned' };
      if (it.requires && !this.owns(it.requires)) return { ok: false, reason: 'requires', requires: items.get(it.requires) };
      if (!user) return { ok: false, reason: 'login' };
      const short = it.price - this.coins();
      if (short > 0) return { ok: false, reason: 'coins', short };
      return { ok: true, left: this.coins() - it.price };
    },
    loginUrl(provider) {
      const back = new URL(location.href);
      back.searchParams.delete('login');
      return `${apiUrl}/auth/${provider}/start?return=${encodeURIComponent(back.href)}`;
    },
    async buy(id) {
      if (!user) return { ok: false, reason: 'login' };
      const r = await api('/shop/buy', { method: 'POST', body: JSON.stringify({ item: id }) });
      if (r.body.state) applyServer(r.body.state);
      onChange();
      if (r.ok) return { ok: true };
      const reason = r.status === 402 ? 'coins' : r.status === 409 ? 'requires' : 'error';
      return { ok: false, reason, message: r.body.error };
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      user = null;
      purchases = {};
      onChange();
    },
    async deleteAccount() {
      const r = await api('/me', { method: 'DELETE' });
      if (r.ok) { user = null; purchases = {}; onChange(); }
      return r.ok;
    },
  };
}
