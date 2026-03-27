// core/store.js — Reactive state store with batched updates and auto-persist.
// No external dependencies. Vanilla ES module.

/**
 * Shallow equality check for arrays and plain objects.
 */
function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
  }
  return false;
}

/**
 * Compile a dot-path string into a selector function.
 * 'ui.metric' → (state) => state.ui.metric
 */
function compilePath(path) {
  const keys = path.split('.');
  return (state) => {
    let val = state;
    for (const k of keys) {
      if (val == null) return undefined;
      val = val[k];
    }
    return val;
  };
}

/**
 * Create a reactive store.
 *
 * @param {Object} initialState
 * @param {Object} reducers — { ACTION_NAME: (state, payload) => newState }
 * @param {Object} [options]
 * @param {string} [options.persistKey] — localStorage key for auto-persist
 * @param {Function} [options.persistFilter] — (state) => subset to persist
 * @param {number} [options.persistDebounceMs] — debounce for persistence (default 300)
 */
export function createStore(initialState, reducers = {}, options = {}) {
  let state = { ...initialState };
  let nextSubId = 1;
  const subscriptions = new Map();

  // Batching
  let pendingNotify = false;
  let batchDepth = 0;
  let dispatchDepth = 0;
  const MAX_REENTRANT = 10;

  // Persistence
  const { persistKey, persistFilter, persistDebounceMs = 300 } = options;
  let persistTimer = null;

  // ─── Core API ─────────────────────────────────────────────

  function getState() {
    return state;
  }

  function select(selectorOrPath) {
    const fn = typeof selectorOrPath === 'string' ? compilePath(selectorOrPath) : selectorOrPath;
    return fn(state);
  }

  function dispatch(action, payload) {
    const reducer = reducers[action];
    if (!reducer) {
      console.warn(`Store: unknown action "${action}"`);
      return;
    }

    if (dispatchDepth > MAX_REENTRANT) {
      console.error(`Store: max re-entrant dispatch depth exceeded for "${action}"`);
      return;
    }

    dispatchDepth++;
    try {
      state = reducer(state, payload);
    } finally {
      dispatchDepth--;
    }

    scheduleFlush();
  }

  function subscribe(selectorOrPath, callback) {
    const fn = typeof selectorOrPath === 'string'
      ? compilePath(selectorOrPath)
      : selectorOrPath;

    const id = nextSubId++;
    const lastValue = fn(state);
    subscriptions.set(id, { selector: fn, callback, lastValue });

    // Return unsubscribe
    return () => subscriptions.delete(id);
  }

  function batch(fn) {
    batchDepth++;
    try {
      fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) flush();
    }
  }

  // ─── Flush (notify subscribers) ───────────────────────────

  function scheduleFlush() {
    if (batchDepth > 0) return; // Inside explicit batch — wait
    if (!pendingNotify) {
      pendingNotify = true;
      queueMicrotask(flush);
    }
  }

  function flush() {
    pendingNotify = false;

    for (const [id, sub] of subscriptions) {
      try {
        const newValue = sub.selector(state);
        if (!shallowEqual(newValue, sub.lastValue)) {
          sub.lastValue = newValue;
          sub.callback(newValue, sub.lastValue);
        }
      } catch (e) {
        console.error('Store subscription error:', e);
      }
    }

    schedulePersist();
  }

  // ─── Persistence ──────────────────────────────────────────

  function schedulePersist() {
    if (!persistKey) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, persistDebounceMs);
  }

  function persist() {
    if (!persistKey) return;
    try {
      const data = persistFilter ? persistFilter(state) : state;
      localStorage.setItem(persistKey, JSON.stringify(data));
    } catch (e) {
      console.warn('Store persist error:', e);
    }
  }

  // ─── Hydration ────────────────────────────────────────────

  function hydrate() {
    if (!persistKey) return;
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) {
        const saved = JSON.parse(raw);
        // Shallow merge saved into state (don't overwrite runtime/data keys)
        if (saved && typeof saved === 'object') {
          dispatch('HYDRATE_STATE', saved);
        }
      }
    } catch (e) {
      console.warn('Store hydrate error:', e);
    }
  }

  return {
    getState,
    select,
    dispatch,
    subscribe,
    batch,
    hydrate,
  };
}
