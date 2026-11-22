// Client behaviour for the learn site: palettes, lesson completion, quizzes,
// course progress and sidebar checkmarks. Progress is stored by the game
// engine as "lesson:<id>", "quiz:<id>" and "course:<slug>" events.
import { readPrefs, writePrefs } from '@portfolio/game';

const game = () => (window as any).game;

function markPalette() {
  document.querySelectorAll<HTMLElement>('[data-learn-palette]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.learnPalette === document.documentElement.dataset.palette)));
}

function completed(): Set<string> {
  const events = game()?.snapshot().events ?? {};
  return new Set(Object.keys(events).filter((k) => k.startsWith('lesson:')).map((k) => k.slice(7)));
}

function refresh() {
  const done = completed();
  // Sidebar ticks
  document.querySelectorAll<HTMLAnchorElement>('#starlight__sidebar a[href]').forEach((a) => {
    const id = a.getAttribute('href')!.replace(/^\/|\/$/g, '');
    a.classList.toggle('lesson-done', done.has(id));
  });
  // Complete buttons
  document.querySelectorAll<HTMLButtonElement>('[data-complete]').forEach((b) => {
    if (done.has(b.dataset.complete!)) {
      b.disabled = true;
      b.innerHTML = '✓ Lesson completed';
    }
  });
  // Course progress (overview page, lesson footer, home cards)
  document.querySelectorAll<HTMLElement>('[data-course-progress]').forEach((el) => {
    const lessons: string[] = JSON.parse(el.dataset.lessons || '[]');
    const n = lessons.filter((l) => done.has(l)).length;
    const pct = lessons.length ? n / lessons.length : 0;
    el.style.setProperty('--cp', String(pct));
    if (el.hasAttribute('data-full')) {
      el.querySelector('.cp-text')!.textContent = `${n} of ${lessons.length} lessons completed`;
      const next = lessons.find((l) => !done.has(l));
      const a = el.querySelector<HTMLAnchorElement>('[data-cp-next]');
      if (a) {
        if (next) { a.href = `/${next}/`; a.textContent = n ? 'Continue where you left off →' : 'Start the course →'; }
        else { a.removeAttribute('href'); a.textContent = '🎓 Course complete!'; }
      }
    } else {
      el.textContent = lessons.length ? `${n}/${lessons.length} lessons` : '';
    }
    const course = el.dataset.courseProgress!;
    if (lessons.length && n === lessons.length) game()?.award(`course:${course}`, 50, { label: 'Course completed!' });
  });
}

export function initLearn() {
  markPalette();
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pal = t.closest<HTMLElement>('[data-learn-palette]');
    if (pal) {
      const id = pal.dataset.learnPalette!;
      document.documentElement.dataset.palette = id;
      const prefs = readPrefs();
      writePrefs({ palettes: { ...(prefs.palettes ?? {}), learn: id } });
      markPalette();
    }
    const done = t.closest<HTMLButtonElement>('[data-complete]');
    if (done) game()?.award(`lesson:${done.dataset.complete}`, game().rewards.lesson ?? 15, { label: 'Lesson completed' });
    if (t.closest('[data-open-ach]')) (document.getElementById('ach-dialog') as HTMLDialogElement)?.showModal();
  });

  document.querySelectorAll<HTMLFormElement>('form[data-quiz]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let right = 0;
      const qs = form.querySelectorAll<HTMLFieldSetElement>('.quiz-q');
      qs.forEach((fs) => {
        const chosen = fs.querySelector<HTMLInputElement>('input:checked');
        const ok = chosen && Number(chosen.value) === Number(fs.dataset.answer);
        if (ok) right++;
        fs.classList.toggle('is-right', !!ok);
        fs.classList.toggle('is-wrong', !ok);
        const why = fs.querySelector<HTMLElement>('.quiz-why');
        if (why) why.hidden = false;
      });
      const result = form.querySelector('.quiz-result')!;
      const id = form.dataset.quiz!;
      if (right === qs.length) {
        result.textContent = `All ${right} correct — well done!`;
        game()?.award(`quiz:${id}`, game().rewards.quiz ?? 20, { label: 'Quiz passed' });
        game()?.award(`lesson:${id}`, game().rewards.lesson ?? 15, { label: 'Lesson completed' });
      } else {
        result.textContent = `${right} of ${qs.length} correct. Read the explanations and try again.`;
      }
    });
  });

  game()?.on((type: string) => { if (type === 'change') refresh(); });
  refresh();
}
