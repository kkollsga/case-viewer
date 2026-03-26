// core/events.js — Simple pub/sub event bus for inter-module communication

const listeners = new Map();

export function on(event, callback) {
  if (!listeners.has(event)) {
    listeners.set(event, []);
  }
  listeners.get(event).push(callback);
  // Return unsubscribe function
  return () => off(event, callback);
}

export function off(event, callback) {
  if (!listeners.has(event)) return;
  const cbs = listeners.get(event);
  const idx = cbs.indexOf(callback);
  if (idx !== -1) cbs.splice(idx, 1);
}

export function emit(event, data) {
  if (!listeners.has(event)) return;
  for (const cb of listeners.get(event)) {
    try {
      cb(data);
    } catch (e) {
      console.error(`Event handler error for "${event}":`, e);
    }
  }
}

// Event name constants
export const EVENTS = {
  // Field events
  FIELD_CHANGED: 'field:changed',
  FIELD_CREATED: 'field:created',
  FIELD_RENAMED: 'field:renamed',
  FIELD_DELETED: 'field:deleted',

  // Case events
  CASE_SELECTED: 'case:selected',
  CASE_CREATED: 'case:created',
  CASE_UPDATED: 'case:updated',
  CASE_DELETED: 'case:deleted',
  CASE_REORDERED: 'case:reordered',
  CASE_NAVIGATE: 'case:navigate',

  // View events
  VIEW_CHANGED: 'view:changed',
  METRIC_CHANGED: 'metric:changed',
  COMPARE_CHANGED: 'compare:changed',

  // UI toggle events
  TOGGLE_PARAMETERS: 'toggle:parameters',
  TOGGLE_HIDE_EMPTY: 'toggle:hideEmpty',
  TOGGLE_DELTA: 'toggle:delta',
  BASE_CASE_CHANGED: 'base:changed',

  // Data events
  DATA_LOADED: 'data:loaded',
  DATA_CLEARED: 'data:cleared',

  // State events
  STATE_LOADED: 'state:loaded',
};
