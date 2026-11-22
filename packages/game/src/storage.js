// Persistence for game state.
//
// localStorage is per origin, so the portfolio and the learn subdomain each
// have their own. When a cookieDomain is configured (e.g. ".example.com"), the
// state is mirrored into a cookie on the parent domain that both subdomains
// can read, and the two are merged on load. Cookies cap out near 4 KB, so the
// mirror is skipped when the state grows past that; localStorage still holds
// everything and the next merge catches up.

const KEY = 'pf.game.v1';
const COOKIE = 'pf_game';
const COOKIE_MAX = 3800;

function safeGet(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readCookie() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  if (!m) return null;
  return safeGet(() => JSON.parse(decodeURIComponent(m[1])));
}

function writeCookie(state, domain) {
  const value = encodeURIComponent(JSON.stringify(state));
  if (value.length > COOKIE_MAX) return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${value}; Domain=${domain}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function createStorage({ cookieDomain = '' } = {}) {
  const useCookie = !!cookieDomain && location.hostname.endsWith(cookieDomain.replace(/^\./, ''));
  return {
    load() {
      const local = safeGet(() => JSON.parse(localStorage.getItem(KEY)));
      const shared = useCookie ? readCookie() : null;
      return { local, shared };
    },
    save(state) {
      safeGet(() => localStorage.setItem(KEY, JSON.stringify(state)));
      if (useCookie) safeGet(() => writeCookie(state, cookieDomain));
    },
    key: KEY,
  };
}

// Visitor preferences (theme, palettes, sound, game on/off). Not game progress,
// so they stay per site.
const PREFS = 'pf.prefs.v1';

export function readPrefs() {
  return safeGet(() => JSON.parse(localStorage.getItem(PREFS)), null) ?? {};
}

export function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  safeGet(() => localStorage.setItem(PREFS, JSON.stringify(next)));
  return next;
}
