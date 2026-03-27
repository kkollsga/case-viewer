// utils/draggable.js — Custom drag-and-drop with dual detection
// Supports both "beside" (reorder) and "on-top" (stack) drop modes.
// No external dependencies. Pure pointer events.

/**
 * Make children of a container draggable with dual-mode drop detection.
 *
 * @param {HTMLElement} container - The parent element
 * @param {Object} options
 * @param {string} options.itemSelector - CSS selector for draggable items
 * @param {string} options.column - Column identifier (prevents cross-group drag)
 * @param {Function} options.onReorder - (dragEl, targetEl, position: 'before'|'after') => void
 * @param {Function} options.onStack - (dragEl, targetEl) => void  — drop ON target
 * @param {Function} options.canStack - (dragEl, targetEl) => boolean — whether on-top stacking is allowed
 */
export function makeDraggable(container, options) {
  const { itemSelector, column, onReorder, onStack, canStack } = options;

  let dragEl = null;
  let dragClone = null;
  let indicator = null;
  let highlightEl = null;
  let offsetX = 0, offsetY = 0;
  let scrollRAF = null;

  function getItems() {
    return Array.from(container.querySelectorAll(itemSelector));
  }

  function createIndicator() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;width:2px;background:#4338ca;border-radius:1px;box-shadow:0 0 6px rgba(67,56,202,0.4);pointer-events:none;z-index:9999;display:none;transition:top 0.05s,left 0.05s,height 0.05s;';
    document.body.appendChild(el);
    return el;
  }

  function showIndicator(targetEl, side) {
    if (!indicator) indicator = createIndicator();
    const r = targetEl.getBoundingClientRect();
    indicator.style.display = 'block';
    indicator.style.height = r.height + 'px';
    indicator.style.top = r.top + 'px';
    indicator.style.left = (side === 'before' ? r.left - 2 : r.right + 1) + 'px';
  }

  function hideIndicator() {
    if (indicator) indicator.style.display = 'none';
  }

  function setHighlight(el) {
    clearHighlight();
    if (el) { el.style.outline = '2.5px solid #4338ca'; el.style.outlineOffset = '0px'; highlightEl = el; }
  }

  function clearHighlight() {
    if (highlightEl) { highlightEl.style.outline = ''; highlightEl.style.outlineOffset = ''; highlightEl = null; }
  }

  function clearAll() {
    hideIndicator();
    clearHighlight();
    if (dragClone) { dragClone.remove(); dragClone = null; }
    if (dragEl) { dragEl.style.opacity = ''; dragEl.style.filter = ''; }
    dragEl = null;
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
  }

  // ─── Pointer-based drag ───────────────────────────────────

  container.addEventListener('pointerdown', (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    // Ignore if clicking a button, input, or toolbar
    if (e.target.closest('button, input, .fs-tb')) return;

    e.preventDefault();
    dragEl = item;

    const r = item.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;

    // Create ghost clone
    dragClone = item.cloneNode(true);
    dragClone.style.cssText = `position:fixed;z-index:9998;pointer-events:none;opacity:0.85;transform:scale(1.02);box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:none;left:${r.left}px;top:${r.top}px;width:${r.width}px;`;
    // Remove toolbar from clone
    const tbClone = dragClone.querySelector('.fs-tb');
    if (tbClone) tbClone.remove();
    document.body.appendChild(dragClone);

    // Dim original
    dragEl.style.opacity = '0.25';
    dragEl.style.filter = 'grayscale(1)';

    // Capture pointer
    container.setPointerCapture(e.pointerId);
  });

  container.addEventListener('pointermove', (e) => {
    if (!dragEl || !dragClone) return;

    // Move ghost
    dragClone.style.left = (e.clientX - offsetX) + 'px';
    dragClone.style.top = (e.clientY - offsetY) + 'px';

    // Find target
    const items = getItems().filter(i => i !== dragEl);
    let closest = null, mode = null;

    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (e.clientX < r.left - 20 || e.clientX > r.right + 20 || e.clientY < r.top - 10 || e.clientY > r.bottom + 10) continue;

      const relX = (e.clientX - r.left) / r.width;
      const isOver = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

      if (isOver) {
        const stackable = canStack ? canStack(dragEl, item) : true;
        if (stackable && relX > 0.2 && relX < 0.8) {
          closest = item; mode = 'ontop'; break;
        } else if (relX <= 0.5) {
          closest = item; mode = 'before'; break;
        } else {
          closest = item; mode = 'after'; break;
        }
      }
    }

    hideIndicator();
    clearHighlight();

    if (closest && mode === 'ontop') {
      setHighlight(closest);
    } else if (closest) {
      showIndicator(closest, mode);
    }
  });

  container.addEventListener('pointerup', (e) => {
    if (!dragEl) return;

    // Determine final drop
    const items = getItems().filter(i => i !== dragEl);
    let closest = null, mode = null;

    for (const item of items) {
      const r = item.getBoundingClientRect();
      const relX = (e.clientX - r.left) / r.width;
      const isOver = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

      if (isOver) {
        const stackable = canStack ? canStack(dragEl, item) : true;
        if (stackable && relX > 0.2 && relX < 0.8) {
          closest = item; mode = 'ontop'; break;
        } else if (relX <= 0.5) {
          closest = item; mode = 'before'; break;
        } else {
          closest = item; mode = 'after'; break;
        }
      }
    }

    const dEl = dragEl;
    clearAll();

    if (closest && mode === 'ontop' && onStack) {
      onStack(dEl, closest);
    } else if (closest && (mode === 'before' || mode === 'after') && onReorder) {
      onReorder(dEl, closest, mode);
    }

    container.releasePointerCapture(e.pointerId);
  });

  // Cancel on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dragEl) clearAll();
  });

  // Cleanup if pointer leaves window
  container.addEventListener('pointercancel', () => clearAll());
}
