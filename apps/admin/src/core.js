// Shared admin state: the hash router, the unsaved-changes guard, the toast
// bus and the "a save happened" signal that drives the publish tracker.
import { useEffect, useState } from 'preact/hooks';
import { ask } from './ui.jsx';

// ---- tiny router & shared state ---------------------------------------------

export function useRoute() {
  const get = () => {
    const [path, q] = (location.hash.slice(1) || '/dashboard').split('?');
    return { path, params: Object.fromEntries(new URLSearchParams(q)) };
  };
  const [route, setRoute] = useState(get);
  useEffect(() => {
    let last = location.hash;
    const on = () => {
      // Back/forward or a typed URL while an editor has unsaved changes.
      if (dirty && location.hash !== last) {
        // Stay put, then ask; leave only if confirmed
        const target = location.hash;
        history.replaceState(null, '', last);
        ask({ title: 'Leave without saving?', body: 'Your changes on this page will be lost.', confirm: 'Leave', danger: true }).then((yes) => { if (yes) { dirty = false; location.hash = target; } });
        return;
      }
      last = location.hash;
      setRoute(get());
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

let dirty = false;
export const setDirty = (v) => { dirty = v; };
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
export const navigate = async (hash) => {
  if (dirty && !(await ask({ title: 'Leave without saving?', body: 'Your changes on this page will be lost.', confirm: 'Leave', danger: true }))) return;
  dirty = false;
  location.hash = hash;
};

/** @type {(t: any) => void} */
let toastSet = () => {};
/** @type {(p: any) => void} */
let publishSet = () => {};
let savedAt = 0; // time of the last save, to watch the deploy
export const registerToast = (fn) => { toastSet = fn; };
export const registerPublish = (fn) => { publishSet = fn; };
export const lastSave = () => savedAt;
export const toast = (msg, kind = 'ok', action) => toastSet({ msg, kind, action, id: Date.now() });
addEventListener('admin-toast', (/** @type {any} */ e) => toast(e.detail.msg, e.detail.kind, e.detail.action));
addEventListener('admin-saved', (/** @type {any} */ e) => { savedAt = Date.now(); publishSet({ since: savedAt, url: e.detail?.url ?? null }); });
/** Report a save (url = the page to view once live). */
export const published = (url) => dispatchEvent(new CustomEvent('admin-saved', { detail: { url } }));

export const editHref = (path, extra = '') => `#/edit?path=${encodeURIComponent(path)}${extra}`;
export const go = (e) => { e.preventDefault(); navigate(e.currentTarget.getAttribute('href')); };
