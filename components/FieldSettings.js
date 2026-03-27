// components/FieldSettings.js — Field-level group name standardization
// Drag-and-drop pill stacking with Sortable.js.

import { getActiveField } from '../core/state.js';
import { loadGroupMappings, saveGroupMappings, collectUniqueGroupValues } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { el, clear } from '../utils/dom.js';
import { PALETTES } from '../utils/color.js';

let containerEl = null;
let visible = false;
let currentMappings = {};
let allUniqueValues = {};

export function init() {}
export function toggle(targetEl) { containerEl = targetEl; visible = !visible; if (visible) render(); else if (containerEl) clear(containerEl); }
export function isVisible() { return visible; }
export function hide() { visible = false; if (containerEl) clear(containerEl); }
export function setupEvents() {}

function persist(field) { saveGroupMappings(field, currentMappings); }
function contrastColor(hex) {
  if (!hex || hex.length < 7) return '#374151';
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.55 ? '#374151' : '#ffffff';
}
function defColor(i) { return PALETTES.vibrant[i % PALETTES.vibrant.length]; }

// ─── Styles ─────────────────────────────────────────────────
let styleInjected = false;
function injectStyles() {
  if (styleInjected) return; styleInjected = true;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
    .fs-ghost { width:2px !important; min-width:2px !important; max-width:2px !important;
      height:26px !important; min-height:26px !important;
      background:#4338ca !important; border-radius:1px !important;
      padding:0 !important; margin:0 1px !important; opacity:1 !important;
      overflow:hidden !important; border:none !important; box-shadow:0 0 6px rgba(67,56,202,0.5) !important; }
    .fs-ghost * { display:none !important; }
    .fs-drag { opacity:0.25 !important; filter:grayscale(1) !important; }
    .fs-drop-target { outline:2px solid #4338ca !important; outline-offset:0px !important; }
  `}));
}

// ─── Main render ────────────────────────────────────────────
export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl); injectStyles();
  const field = getActiveField();
  if (!field) return;
  currentMappings = loadGroupMappings(field);
  allUniqueValues = collectUniqueGroupValues(field);
  if (Object.keys(allUniqueValues).length === 0) {
    containerEl.appendChild(el('div', { class:'text-xs text-gray-400 py-4 text-center', textContent:'No group values found. Import cases first.' }));
    return;
  }
  const wrapper = el('div', { class:'bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-5' });
  wrapper.appendChild(el('div', { class:'flex items-center justify-between' }, [
    el('span', { class:'text-xs font-semibold text-gray-600 uppercase tracking-wider', textContent:'Group Standardization' }),
    el('span', { class:'text-[10px] text-gray-400', textContent:'Drag to reorder or stack' }),
  ]));
  const order = currentMappings.__groupOrder || Object.keys(allUniqueValues);
  const allCols = Object.keys(allUniqueValues);
  const cols = [...order.filter(c => allCols.includes(c)), ...allCols.filter(c => !order.includes(c))];
  const sections = el('div', { class:'space-y-4', id:'group-sections-container' });
  for (const col of cols) sections.appendChild(renderSection(field, col));
  wrapper.appendChild(sections);
  containerEl.appendChild(wrapper);
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(sections, { animation:150, handle:'.gs-handle', ghostClass:'opacity-30',
      onEnd: () => { currentMappings.__groupOrder = Array.from(sections.children).map(s => s.dataset.column); persist(field); } });
  }, 50);
}

// ─── Section per column ─────────────────────────────────────
function renderSection(field, column) {
  const vals = allUniqueValues[column] || [];
  const sec = el('div', { class:'space-y-1.5', dataset:{ column } });
  const hdr = el('div', { class:'gs-handle flex items-center gap-2 cursor-grab py-1' });
  hdr.append(el('i',{class:'fas fa-grip-vertical text-[10px] text-gray-300'}), el('span',{class:'text-xs font-medium text-gray-500 uppercase tracking-wider',textContent:column}), el('span',{class:'text-[10px] text-gray-300',textContent:`${vals.length}`}));
  sec.appendChild(hdr);

  const items = el('div', { class:'flex flex-wrap gap-1.5 items-center gs-items', dataset:{ column } });
  const stacks = currentMappings[column] || [];
  const assigned = new Set(); for (const s of stacks) for (const v of s.values) assigned.add(v);
  for (let i = 0; i < stacks.length; i++) items.appendChild(renderStack(field, column, stacks[i], i));
  for (const v of vals.filter(v => !assigned.has(v))) items.appendChild(renderPill(v));
  sec.appendChild(items);

  // Sortable: top-level reorder + pill-on-pill/stack detection
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(items, {
      animation:0, group:{ name:`col-${column}`, pull:false, put:[`inner-${column}`] },
      ghostClass:'fs-ghost', dragClass:'fs-drag', filter:'.gs-toolbar',
      onAdd: () => fullRebuild(field, column, items),
      onEnd: (evt) => {
        const drag = evt.item, rect = drag.getBoundingClientRect();
        let hit = null;
        for (const ch of items.children) {
          if (ch === drag) continue;
          const r = ch.getBoundingClientRect();
          if (Math.max(0,Math.min(rect.right,r.right)-Math.max(rect.left,r.left)) > r.width*0.3 &&
              Math.max(0,Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top)) > r.height*0.3) { hit = ch; break; }
        }
        if (hit && drag.dataset.gs === 'pill' && hit.dataset.gs === 'pill') {
          const dv = drag.dataset.value, tv = hit.dataset.value;
          removeVal(column, dv); removeVal(column, tv);
          if (!currentMappings[column]) currentMappings[column] = [];
          currentMappings[column].push({ name:tv, values:[tv, dv] });
          persist(field); render();
        } else if (hit && drag.dataset.gs === 'pill' && hit.dataset.gs === 'stack') {
          const dv = drag.dataset.value; removeVal(column, dv);
          const st = (currentMappings[column]||[]).find(s => s.name === hit.dataset.stackName);
          if (st && !st.values.includes(dv)) st.values.push(dv);
          persist(field); render();
        } else { fullRebuild(field, column, items); }
      },
    });
    // Inner pill zones
    for (const pz of items.querySelectorAll('.gs-inner')) {
      Sortable.create(pz, {
        animation:0, group:{ name:`inner-${column}`, pull:true, put:true },
        ghostClass:'fs-ghost', dragClass:'fs-drag',
        onEnd: () => fullRebuild(field, column, items),
        onAdd: () => fullRebuild(field, column, items),
        onRemove: (evt) => {
          if (evt.from.children.length === 0) {
            const se = evt.from.closest('[data-gs=stack]');
            if (se) { const nm = se.dataset.stackName; const ss = currentMappings[column]||[]; const ix = ss.findIndex(s=>s.name===nm); if(ix!==-1)ss.splice(ix,1); se.remove(); }
          }
          fullRebuild(field, column, items);
        },
      });
    }
  }, 50);
  return sec;
}

// ─── Bare pill ──────────────────────────────────────────────
function renderPill(value) {
  const wrap = el('div', { class:'relative group/p', dataset:{ gs:'pill', value } });
  // Toolbar
  const tb = el('div', { class:'gs-toolbar absolute -top-2.5 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-sm shadow-sm opacity-0 group-hover/p:opacity-100 transition-all z-10 flex overflow-hidden' });
  tb.appendChild(el('button', { class:'px-1 py-px text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50',
    innerHTML:'<i class="fas fa-pen text-[6px]"></i>',
    onClick:(e)=>{ e.stopPropagation(); const f=getActiveField(), c=wrap.closest('.gs-items')?.dataset.column;
      if(!f||!c)return; if(!currentMappings[c])currentMappings[c]=[]; currentMappings[c].push({name:value,color:defColor(currentMappings[c].length),values:[value]}); persist(f); render(); }
  }));
  wrap.appendChild(tb);
  wrap.appendChild(el('span', { class:'inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap', textContent:value }));
  return wrap;
}

// ─── Stack wrapper ──────────────────────────────────────────
function renderStack(field, column, stack, index) {
  const color = stack.color || defColor(index), tc = contrastColor(color);
  const outer = el('div', { class:'relative group/s', dataset:{ gs:'stack', stackName:stack.name } });

  // Toolbar (centered above)
  const tb = el('div', { class:'gs-toolbar absolute -top-2.5 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-sm shadow-sm opacity-0 group-hover/s:opacity-100 transition-all z-10 flex overflow-hidden' });
  tb.append(
    el('button', { class:'px-1 py-px text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50', innerHTML:'<i class="fas fa-pen text-[6px]"></i>', onClick:(e)=>{e.stopPropagation();showEdit();} }),
    el('button', { class:'px-1 py-px text-gray-300 hover:text-red-500 hover:bg-red-50', innerHTML:'<i class="fas fa-times text-[7px]"></i>',
      onClick:()=>{ const s=currentMappings[column]||[]; const i=s.indexOf(stack); if(i!==-1)s.splice(i,1); persist(field); render(); } }),
  );
  outer.appendChild(tb);

  // Colored row
  const row = el('div', { class:'inline-flex items-center gap-1 rounded-full pl-3 pr-1.5 py-0.5', style:{backgroundColor:color} });

  // Color picker
  const cp = el('input',{type:'color',class:'absolute w-0 h-0 opacity-0',value:color});
  cp.addEventListener('input',e=>{stack.color=e.target.value;row.style.backgroundColor=e.target.value;persist(field);});
  row.addEventListener('dblclick',e=>{if(e.target===row)cp.click();}); row.appendChild(cp);

  // Title
  const lbl = el('span',{class:'text-xs font-semibold whitespace-nowrap',textContent:stack.name,style:{color:tc}});
  // Edit input (transparent, blends with wrapper)
  const inp = el('input',{type:'text',class:'text-xs font-semibold border-0 focus:outline-none hidden whitespace-nowrap',value:stack.name,
    style:{color:tc,backgroundColor:'rgba(255,255,255,0.25)',borderRadius:'4px',padding:'0 4px',width:Math.max(3,stack.name.length*0.6)+'rem',caretColor:tc}});
  const ok = el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-green-500 text-white text-[7px] hover:bg-green-600 hidden flex-shrink-0',innerHTML:'<i class="fas fa-check"></i>'});
  const cx = el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-white/50 text-red-400 hover:text-red-600 text-[7px] hidden flex-shrink-0',innerHTML:'<i class="fas fa-times"></i>'});

  function showEdit(){ lbl.classList.add('hidden'); tb.classList.add('hidden'); inp.classList.remove('hidden'); ok.classList.remove('hidden'); cx.classList.remove('hidden'); inp.value=stack.name; inp.style.width=Math.max(3,stack.name.length*0.6)+'rem'; requestAnimationFrame(()=>{inp.focus();inp.select();}); }
  function hideEdit(){ inp.classList.add('hidden'); ok.classList.add('hidden'); cx.classList.add('hidden'); lbl.classList.remove('hidden'); tb.classList.remove('hidden'); }
  function commit(){ const n=inp.value.trim(); if(n){stack.name=n;lbl.textContent=n;outer.dataset.stackName=n;persist(field);} hideEdit(); }
  ok.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();commit();});
  cx.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();hideEdit();});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape')hideEdit();});
  inp.addEventListener('input',()=>{inp.style.width=Math.max(3,inp.value.length*0.6)+'rem';});

  row.append(lbl, inp, ok, cx);

  // Inner pills (sortable, can be dragged out)
  const pz = el('div', { class:'gs-inner inline-flex flex-wrap gap-1 items-center', dataset:{stackName:stack.name,column} });
  for (const v of stack.values) {
    pz.appendChild(el('span', { class:'inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-white/90 text-gray-700 whitespace-nowrap cursor-grab select-none hover:bg-white', textContent:v, dataset:{value:v} }));
  }
  row.appendChild(pz);
  outer.appendChild(row);
  return outer;
}

// ─── Helpers ────────────────────────────────────────────────
function removeVal(col, val) {
  const ss = currentMappings[col]||[];
  for (let i=ss.length-1;i>=0;i--) { const x=ss[i].values.indexOf(val); if(x!==-1){ss[i].values.splice(x,1);if(ss[i].values.length===0)ss.splice(i,1);} }
}
function fullRebuild(field, column, container) {
  const ns = [];
  for (const ch of container.children) {
    if (ch.dataset.gs === 'stack') {
      const pz = ch.querySelector('.gs-inner');
      const pills = pz ? Array.from(pz.children).map(p=>p.dataset.value).filter(Boolean) : [];
      if (!pills.length) continue;
      const nm = ch.dataset.stackName;
      const ex = (currentMappings[column]||[]).find(s=>s.name===nm);
      ns.push({ name:ex?.name||pills[0], color:ex?.color, values:pills });
    }
  }
  currentMappings[column] = ns;
  persist(field);
  render();
}
