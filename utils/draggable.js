// utils/draggable.js — Custom drag-and-drop with dual detection
// Supports "beside" (reorder) and "on-top" (stack) drop modes.
// Also supports dragging inner elements out of containers.

/**
 * @param {HTMLElement} container
 * @param {Object} options
 * @param {string} options.itemSelector - CSS selector for top-level draggable items
 * @param {string} [options.innerSelector] - CSS selector for inner draggable items (e.g. pills inside stacks)
 * @param {Function} options.onReorder - (dragEl, targetEl, position) => void
 * @param {Function} options.onStack - (dragEl, targetEl) => void
 * @param {Function} [options.onInnerDragOut] - (value, fromStackName) => void — inner item dragged to top level
 * @param {Function} [options.canStack] - (dragEl, targetEl) => boolean
 */
export function makeDraggable(container, options) {
  const { itemSelector, innerSelector, onReorder, onStack, onInnerDragOut, canStack } = options;

  let dragEl = null;
  let dragClone = null;
  let indicator = null;
  let highlightEl = null;
  let isDragging = false;
  let isInner = false;
  let innerValue = null;
  let innerFromStack = null;
  let offsetX = 0, offsetY = 0;
  let startX = 0, startY = 0;
  const DRAG_THRESHOLD = 5;

  function getItems() {
    return Array.from(container.querySelectorAll(itemSelector)).filter(i => i !== dragEl);
  }

  function createIndicator() {
    if (indicator) return indicator;
    const ind = document.createElement('div');
    ind.style.cssText = 'position:fixed;width:2px;background:#4338ca;border-radius:1px;box-shadow:0 0 6px rgba(67,56,202,0.4);pointer-events:none;z-index:9999;display:none;';
    document.body.appendChild(ind);
    indicator = ind;
    return ind;
  }

  function showIndicator(el, side) {
    createIndicator();
    const r = el.getBoundingClientRect();
    indicator.style.display = 'block';
    indicator.style.height = r.height + 'px';
    indicator.style.top = r.top + 'px';
    indicator.style.left = (side === 'before' ? r.left - 2 : r.right + 1) + 'px';
  }

  function hideIndicator() { if (indicator) indicator.style.display = 'none'; }

  function setHighlight(el) {
    clearHighlight();
    if (el) { el.style.outline = '2.5px solid #4338ca'; el.style.outlineOffset = '0px'; highlightEl = el; }
  }

  function clearHighlight() {
    if (highlightEl) { highlightEl.style.outline = ''; highlightEl.style.outlineOffset = ''; highlightEl = null; }
  }

  function clearAll() {
    hideIndicator(); clearHighlight();
    if (dragClone) { dragClone.remove(); dragClone = null; }
    if (dragEl) { dragEl.style.opacity = ''; dragEl.style.filter = ''; }
    dragEl = null; isDragging = false; isInner = false; innerValue = null; innerFromStack = null;
  }

  function detectDrop(clientX, clientY) {
    const items = getItems();
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (clientX < r.left - 10 || clientX > r.right + 10 || clientY < r.top - 5 || clientY > r.bottom + 5) continue;

      const relX = (clientX - r.left) / r.width;
      const isOver = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;

      if (isOver) {
        const stackable = canStack ? canStack(dragEl, item) : true;
        if (stackable && relX > 0.2 && relX < 0.8) return { target: item, mode: 'ontop' };
        return { target: item, mode: relX <= 0.5 ? 'before' : 'after' };
      }
    }
    return null;
  }

  // ─── Pointer events ───────────────────────────────────────

  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, .fs-tb')) return;
    if (e.button !== 0) return; // left button only

    // Check inner items first (priority)
    let item = null;
    if (innerSelector) {
      item = e.target.closest(innerSelector);
      if (item && container.contains(item)) {
        isInner = true;
        innerValue = item.dataset.value;
        const stackOuter = item.closest(itemSelector);
        innerFromStack = stackOuter?.dataset.stackName || null;
      }
    }

    if (!item) {
      item = e.target.closest(itemSelector);
      if (!item || !container.contains(item)) return;
      isInner = false;
    }

    e.preventDefault();
    dragEl = item;
    startX = e.clientX;
    startY = e.clientY;

    const r = item.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;

    container.setPointerCapture(e.pointerId);
  });

  container.addEventListener('pointermove', (e) => {
    if (!dragEl) return;

    // Start dragging only after threshold
    if (!isDragging) {
      if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return;
      isDragging = true;

      // Create ghost
      dragClone = dragEl.cloneNode(true);
      // Remove toolbar from clone
      dragClone.querySelectorAll('.fs-tb').forEach(t => t.remove());
      const r = dragEl.getBoundingClientRect();
      dragClone.style.cssText = `position:fixed;z-index:9998;pointer-events:none;opacity:0.85;transform:scale(1.02);box-shadow:0 4px 12px rgba(0,0,0,0.15);left:${r.left}px;top:${r.top}px;width:${r.width}px;`;
      document.body.appendChild(dragClone);

      dragEl.style.opacity = '0.25';
      dragEl.style.filter = 'grayscale(1)';
    }

    // Move ghost
    dragClone.style.left = (e.clientX - offsetX) + 'px';
    dragClone.style.top = (e.clientY - offsetY) + 'px';

    // Detect hover
    hideIndicator(); clearHighlight();
    const drop = detectDrop(e.clientX, e.clientY);
    if (drop) {
      if (drop.mode === 'ontop') setHighlight(drop.target);
      else showIndicator(drop.target, drop.mode);
    }
  });

  container.addEventListener('pointerup', (e) => {
    if (!dragEl) return;

    if (!isDragging) { clearAll(); container.releasePointerCapture(e.pointerId); return; }

    const drop = detectDrop(e.clientX, e.clientY);
    const dEl = dragEl;
    const wasInner = isInner;
    const val = innerValue;
    const fromStack = innerFromStack;
    clearAll();
    container.releasePointerCapture(e.pointerId);

    if (!drop) return;

    if (wasInner && onInnerDragOut) {
      // Inner pill dragged — could be onto another item or to top level
      if (drop.mode === 'ontop' && onStack) {
        onInnerDragOut(val, fromStack);
        // The value was removed from its stack, now stack it onto target
        // We need to signal this differently — just call onStack with synthetic info
      }
      // For simplicity: inner drag always removes from stack, re-renders
      onInnerDragOut(val, fromStack);
      return;
    }

    if (drop.mode === 'ontop' && onStack) {
      onStack(dEl, drop.target);
    } else if (onReorder) {
      onReorder(dEl, drop.target, drop.mode);
    }
  });

  container.addEventListener('pointercancel', () => clearAll());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dragEl) clearAll(); });
}
