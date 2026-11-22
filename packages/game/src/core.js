// Game core: pure logic, no DOM. Everything a visitor has earned is derived
// from two maps, so state from two sources (localStorage and a cross-subdomain
// cookie) can be merged by simple union without double counting.
//
//   events: { [eventId]: points }   each event can be awarded once
//   ach:    { [achievementId]: 1 }  unlocked achievements
//
// XP is never stored; it is the sum of event points plus achievement bonuses.

export const STATE_VERSION = 1;

/** A fresh, empty state. */
export function emptyState() {
  return { v: STATE_VERSION, events: {}, ach: {} };
}

/** Coerce anything (old versions, corrupt JSON, null) into a valid state. */
export function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  if (raw.events && typeof raw.events === 'object') {
    for (const [id, pts] of Object.entries(raw.events)) {
      const n = Number(pts);
      if (typeof id === 'string' && id.length <= 200 && Number.isFinite(n) && n >= 0 && n <= 1000) {
        s.events[id] = n;
      }
    }
  }
  if (raw.ach && typeof raw.ach === 'object') {
    for (const id of Object.keys(raw.ach)) s.ach[id] = 1;
  }
  return s;
}

/** Union of two states. Where both hold an event, the higher points win. */
export function mergeStates(a, b) {
  const x = normalizeState(a);
  const y = normalizeState(b);
  const out = emptyState();
  for (const s of [x, y]) {
    for (const [id, pts] of Object.entries(s.events)) {
      out.events[id] = Math.max(out.events[id] ?? 0, pts);
    }
    Object.assign(out.ach, s.ach);
  }
  return out;
}

/** Total XP for a state, given the achievement definitions (for bonuses). */
export function totalXp(state, achievements = []) {
  let xp = 0;
  for (const pts of Object.values(state.events)) xp += pts;
  for (const a of achievements) if (state.ach[a.id]) xp += a.bonus ?? 0;
  return xp;
}

/**
 * Level info for an XP total.
 * levels: [{ xp, name }] sorted ascending, first must be xp 0.
 */
export function levelFor(xp, levels) {
  let idx = 0;
  for (let i = 0; i < levels.length; i++) if (xp >= levels[i].xp) idx = i;
  const cur = levels[idx];
  const next = levels[idx + 1] ?? null;
  const span = next ? next.xp - cur.xp : 1;
  const progress = next ? Math.min(1, (xp - cur.xp) / span) : 1;
  return { index: idx, number: idx + 1, name: cur.name, current: cur, next, progress };
}

/** Number of distinct events whose id starts with prefix. */
export function countPrefix(state, prefix) {
  let n = 0;
  for (const id of Object.keys(state.events)) if (id.startsWith(prefix)) n++;
  return n;
}

/**
 * Is an achievement rule satisfied?
 * ctx.pageIds lists every page id for the "all-pages" rule.
 */
export function ruleMet(rule, state, xp, ctx = {}) {
  switch (rule?.type) {
    case 'xp':
      return xp >= (rule.min ?? 0);
    case 'event':
      return rule.id in state.events;
    case 'events':
      return countPrefix(state, rule.prefix ?? '') >= (rule.min ?? 1);
    case 'all-of':
      return Array.isArray(rule.ids) && rule.ids.every((id) => id in state.events);
    case 'all-pages': {
      const ids = ctx.pageIds ?? [];
      return ids.length > 0 && ids.every((p) => `visit:${p}` in state.events);
    }
    default:
      return false;
  }
}

/**
 * Create a game engine.
 *
 * config: { levels, achievements, pageIds }
 * load():  returns a raw state (or null)
 * save(s): persists a state
 * emit(type, detail): notification hook — 'award', 'achievement', 'level', 'change'
 */
export function createEngine({ config, load, save, emit = () => {} }) {
  const achievements = config.achievements ?? [];
  const levels = config.levels?.length ? config.levels : [{ xp: 0, name: 'Visitor' }];
  const ctx = { pageIds: config.pageIds ?? [] };
  let state = normalizeState(load());

  const xp = () => totalXp(state, achievements);

  // Unlock achievements until nothing new unlocks (a bonus can push XP over
  // an xp-rule threshold, so one pass is not always enough).
  function checkAchievements() {
    const unlocked = [];
    let changed = true;
    while (changed) {
      changed = false;
      const cur = xp();
      for (const a of achievements) {
        if (state.ach[a.id]) continue;
        if (ruleMet(a.rule, state, cur, ctx)) {
          state.ach[a.id] = 1;
          unlocked.push(a);
          changed = true;
        }
      }
    }
    return unlocked;
  }

  function commit(beforeXp) {
    const beforeLevel = levelFor(beforeXp, levels).index;
    const unlocked = checkAchievements();
    save(state);
    for (const a of unlocked) emit('achievement', { achievement: a });
    const after = xp();
    const lvl = levelFor(after, levels);
    if (lvl.index > beforeLevel) emit('level', { level: lvl });
    emit('change', snapshot());
  }

  /** Award points for an event. Returns true if this was the first time. */
  function award(id, points = 0, meta = {}) {
    if (typeof id !== 'string' || !id) return false;
    if (id in state.events) return false;
    const before = xp();
    const pts = Math.max(0, Math.min(1000, Number(points) || 0));
    state.events[id] = pts;
    emit('award', { id, points: pts, meta });
    commit(before);
    return true;
  }

  function has(id) {
    return id in state.events;
  }

  /** Pull in state written elsewhere (another tab, another subdomain). */
  function absorb(raw) {
    const before = xp();
    state = mergeStates(state, raw);
    commit(before);
  }

  function reset() {
    state = emptyState();
    save(state);
    emit('change', snapshot());
  }

  function snapshot() {
    const total = xp();
    return {
      xp: total,
      level: levelFor(total, levels),
      achievements: achievements.map((a) => ({ ...a, unlocked: !!state.ach[a.id] })),
      events: { ...state.events },
    };
  }

  // Achievements may be satisfiable by state loaded from storage (e.g. after
  // new achievements are added in the admin panel).
  const initial = checkAchievements();
  if (initial.length) save(state);

  return { award, has, absorb, reset, snapshot, xp, countPrefix: (p) => countPrefix(state, p) };
}
