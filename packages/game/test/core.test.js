import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, mergeStates, normalizeState, levelFor, totalXp } from '../src/core.js';

const levels = [{ xp: 0, name: 'A' }, { xp: 20, name: 'B' }, { xp: 50, name: 'C' }];
const achievements = [
  { id: 'two-pages', bonus: 10, rule: { type: 'events', prefix: 'visit:', min: 2 } },
  { id: 'all', bonus: 5, rule: { type: 'all-pages' } },
  { id: 'rich', bonus: 0, rule: { type: 'xp', min: 40 } },
  { id: 'secret', bonus: 50, rule: { type: 'event', id: 'secret:x' } },
];

function mk(initial = null) {
  let saved = initial;
  const events = [];
  const engine = createEngine({
    config: { levels, achievements, pageIds: ['', 'about', 'projects'] },
    load: () => saved,
    save: (s) => (saved = structuredClone(s)),
    emit: (t, d) => events.push([t, d]),
  });
  return { engine, events, saved: () => saved };
}

test('awards each event only once', () => {
  const { engine } = mk();
  assert.equal(engine.award('visit:about', 5), true);
  assert.equal(engine.award('visit:about', 5), false);
  assert.equal(engine.xp(), 5);
});

test('achievement bonus cascades into xp rules', () => {
  const { engine, events } = mk();
  engine.award('visit:', 5);
  engine.award('visit:about', 5); // two-pages: +10 → 20
  engine.award('visit:projects', 5); // all: +5 → 30
  assert.equal(engine.xp(), 30);
  engine.award('secret:x', 0); // +50 → 80, crosses rich (40)
  const unlocked = events.filter(([t]) => t === 'achievement').map(([, d]) => d.achievement.id);
  assert.deepEqual(unlocked, ['two-pages', 'all', 'secret', 'rich']);
});

test('emits level up', () => {
  const { engine, events } = mk();
  engine.award('x', 25);
  assert.ok(events.some(([t, d]) => t === 'level' && d.level.name === 'B'));
});

test('merge is a union and never double counts', () => {
  const a = { events: { a: 5, b: 5 }, ach: { one: 1 } };
  const b = { events: { b: 5, c: 10 }, ach: { two: 1 } };
  const m = mergeStates(a, b);
  assert.deepEqual(m.events, { a: 5, b: 5, c: 10 });
  assert.equal(totalXp(m), 20);
  assert.deepEqual(Object.keys(m.ach).sort(), ['one', 'two']);
});

test('normalize rejects garbage', () => {
  assert.deepEqual(normalizeState('nope').events, {});
  assert.deepEqual(normalizeState({ events: { ok: 3, bad: 'x', neg: -1, huge: 1e9 } }).events, { ok: 3 });
});

test('level progress', () => {
  assert.equal(levelFor(0, levels).name, 'A');
  assert.equal(levelFor(35, levels).progress, 0.5);
  assert.equal(levelFor(999, levels).next, null);
});

test('achievements already satisfied by stored state unlock on load', () => {
  const { engine } = mk({ events: { 'secret:x': 0 }, ach: {} });
  assert.equal(engine.snapshot().achievements.find((a) => a.id === 'secret').unlocked, true);
});
