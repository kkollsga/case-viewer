// components/FieldSettings.js — Field-level group name standardization
// Native HTML5 drag-and-drop for dual detection: on-top vs beside.

import { getActiveField } from '../core/state.js';
import { loadGroupMappings, saveGroupMappings, collectUniqueGroupValues } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { el, clear } from '../utils/dom.js';
import { PALETTES } from '../utils/color.js';

let containerEl = null, visible = false, currentMappings = {}, allUniqueValues = {};

export function init() {}
export function toggle(t) { containerEl = t; visible = !visible; if (visible) render(); else if (containerEl) clear(containerEl); }
export function isVisible() { return visible; }
export function hide() { visible = false; if (containerEl) clear(containerEl); }
export function setupEvents() {}

function persist(f) { saveGroupMappings(f, currentMappings); }
function cc(h) { if(!h||h.length<7)return'#374151'; const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16); return(0.299*r+0.587*g+0.114*b)/255>0.55?'#374151':'#fff'; }
function dc(i) { return PALETTES.vibrant[i % PALETTES.vibrant.length]; }

// ─── Drag state ─────────────────────────────────────────────
let dragData = null;      // { column, value, element }
let dropIndicator = null;  // the vertical line element
let currentDropTarget = null;
let currentDropMode = null; // 'before' | 'after' | 'ontop'

function createIndicator() {
  const ind = document.createElement('div');
  ind.style.cssText = 'width:2px;height:24px;background:#4338ca;border-radius:1px;box-shadow:0 0 6px rgba(67,56,202,0.4);position:absolute;pointer-events:none;z-index:50;display:none;';
  document.body.appendChild(ind);
  return ind;
}

function showIndicatorBeside(targetEl, side) {
  if (!dropIndicator) dropIndicator = createIndicator();
  const r = targetEl.getBoundingClientRect();
  dropIndicator.style.display = 'block';
  dropIndicator.style.height = r.height + 'px';
  dropIndicator.style.top = r.top + window.scrollY + 'px';
  dropIndicator.style.left = (side === 'before' ? r.left - 2 : r.right) + window.scrollX + 'px';
}

function hideIndicator() {
  if (dropIndicator) dropIndicator.style.display = 'none';
}

function clearAllHighlights() {
  hideIndicator();
  document.querySelectorAll('.fs-ontop').forEach(e => e.classList.remove('fs-ontop'));
  currentDropTarget = null;
  currentDropMode = null;
}

// ─── Styles ─────────────────────────────────────────────────
let si = false;
function injectStyles() {
  if (si) return; si = true;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
    .fs-dragging { opacity:0.25!important; filter:grayscale(1)!important; }
    .fs-ontop { outline:2.5px solid #4338ca!important; outline-offset:0!important; }
    .fs-tb { position:absolute; top:100%; right:0; margin-top:2px; display:flex; align-items:center;
      background:#fff; border:1px solid #e5e7eb; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.08);
      opacity:0; transition:opacity 0.15s; z-index:10; overflow:hidden; pointer-events:auto; }
    .group\\/p:hover .fs-tb, .group\\/s:hover .fs-tb { opacity:1; }
  `}));
}

// ─── Render ─────────────────────────────────────────────────
export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl); injectStyles();
  const field = getActiveField(); if (!field) return;
  currentMappings = loadGroupMappings(field);
  allUniqueValues = collectUniqueGroupValues(field);
  if (!Object.keys(allUniqueValues).length) { containerEl.appendChild(el('div',{class:'text-xs text-gray-400 py-4 text-center',textContent:'No group values found.'})); return; }

  const w = el('div',{class:'bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-5'});
  w.appendChild(el('div',{class:'flex items-center justify-between'},[
    el('span',{class:'text-xs font-semibold text-gray-600 uppercase tracking-wider',textContent:'Group Standardization'}),
    el('span',{class:'text-[10px] text-gray-400',textContent:'Drag to reorder or stack'}),
  ]));
  const ac = Object.keys(allUniqueValues);
  const order = currentMappings.__groupOrder || ac;
  const cols = [...order.filter(c=>ac.includes(c)), ...ac.filter(c=>!order.includes(c))];
  const secs = el('div',{class:'space-y-4'});
  for (const c of cols) secs.appendChild(renderSection(field, c));
  w.appendChild(secs);
  containerEl.appendChild(w);

  // Group-level reorder via Sortable
  setTimeout(()=>{if(typeof Sortable==='undefined')return;
    Sortable.create(secs,{animation:150,handle:'.gs-handle',ghostClass:'opacity-30',
      onEnd:()=>{currentMappings.__groupOrder=Array.from(secs.children).map(s=>s.dataset.column);persist(field);}});
  },50);
}

// ─── Section ────────────────────────────────────────────────
function renderSection(field, column) {
  const vals = allUniqueValues[column]||[];
  const sec = el('div',{class:'space-y-1.5',dataset:{column}});
  const hdr = el('div',{class:'gs-handle flex items-center gap-2 cursor-grab py-1'});
  hdr.append(el('i',{class:'fas fa-grip-vertical text-[10px] text-gray-300'}),el('span',{class:'text-xs font-medium text-gray-500 uppercase tracking-wider',textContent:column}),el('span',{class:'text-[10px] text-gray-300',textContent:`${vals.length}`}));
  sec.appendChild(hdr);

  const items = el('div',{class:'flex flex-wrap gap-1.5 items-center gs-items',dataset:{column}});
  const stacks = currentMappings[column]||[];
  const asgn = new Set(); for(const s of stacks) for(const v of s.values) asgn.add(v);
  for(let i=0;i<stacks.length;i++) items.appendChild(renderStack(field,column,stacks[i],i));
  for(const v of vals.filter(v=>!asgn.has(v))) items.appendChild(renderPill(field,column,v));
  sec.appendChild(items);

  // Drop zone: the items container accepts drops
  items.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragData || dragData.column !== column) return;

    // Find which child we're over
    const children = Array.from(items.children).filter(c => c !== dragData.element && !c.classList.contains('fs-dragging'));
    let closest = null, closestDist = Infinity, mode = null;

    for (const child of children) {
      const r = child.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const mouseX = e.clientX;

      // Center zone = on-top, edge zones = beside
      const relX = (mouseX - r.left) / r.width; // 0..1
      const isOver = e.clientY >= r.top && e.clientY <= r.bottom && mouseX >= r.left && mouseX <= r.right;

      if (isOver) {
        if (child.dataset.gs === 'pill' && relX > 0.25 && relX < 0.75) {
          // On-top of bare pill
          closest = child; mode = 'ontop'; closestDist = 0; break;
        } else if (child.dataset.gs === 'stack' && relX > 0.15 && relX < 0.85) {
          // On-top of stack
          closest = child; mode = 'ontop'; closestDist = 0; break;
        } else if (relX <= 0.25 || relX <= 0.15) {
          closest = child; mode = 'before'; closestDist = 0; break;
        } else {
          closest = child; mode = 'after'; closestDist = 0; break;
        }
      }

      // Not directly over, find nearest edge
      const distLeft = Math.abs(mouseX - r.left);
      const distRight = Math.abs(mouseX - r.right);
      const minDist = Math.min(distLeft, distRight);
      if (minDist < closestDist) {
        closestDist = minDist;
        closest = child;
        mode = distLeft < distRight ? 'before' : 'after';
      }
    }

    clearAllHighlights();

    if (closest && mode === 'ontop') {
      closest.classList.add('fs-ontop');
      currentDropTarget = closest;
      currentDropMode = 'ontop';
    } else if (closest && (mode === 'before' || mode === 'after')) {
      showIndicatorBeside(closest, mode);
      currentDropTarget = closest;
      currentDropMode = mode;
    }
  });

  items.addEventListener('dragleave', (e) => {
    // Only clear if actually leaving the container
    if (!items.contains(e.relatedTarget)) clearAllHighlights();
  });

  items.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragData || dragData.column !== column) { clearAllHighlights(); return; }

    const target = currentDropTarget;
    const mode = currentDropMode;
    clearAllHighlights();

    if (!target) return;

    const dragValue = dragData.value;
    const dragIsInner = dragData.fromStack !== null;

    if (mode === 'ontop') {
      if (target.dataset.gs === 'pill') {
        // Pill onto pill → create stack
        const targetVal = target.dataset.value;
        removeVal(column, dragValue);
        removeVal(column, targetVal);
        if (!currentMappings[column]) currentMappings[column] = [];
        currentMappings[column].push({ name: targetVal, values: [targetVal, dragValue] });
      } else if (target.dataset.gs === 'stack') {
        // Pill onto stack → add to stack
        removeVal(column, dragValue);
        const st = (currentMappings[column]||[]).find(s => s.name === target.dataset.stackName);
        if (st && !st.values.includes(dragValue)) st.values.push(dragValue);
      }
    } else {
      // Beside drop → reorder
      removeVal(column, dragValue);
      // Rebuild order from DOM, inserting the dragged value at the right position
      // For simplicity, just rebuild and re-render
    }

    persist(field);
    render();
  });

  return sec;
}

// ─── Bare pill ──────────────────────────────────────────────
function renderPill(field, column, value) {
  const w = el('div',{class:'relative group/p',dataset:{gs:'pill',value},draggable:'true'});
  const pill = el('span',{class:'inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap',textContent:value});
  w.appendChild(pill);

  // Toolbar below
  const tb = el('div',{class:'fs-tb'});
  tb.appendChild(el('button',{class:'px-1.5 py-0.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50',innerHTML:'<i class="fas fa-pen text-[7px]"></i>',
    onClick:(e)=>{e.stopPropagation();if(!currentMappings[column])currentMappings[column]=[];currentMappings[column].push({name:value,color:dc(currentMappings[column].length),values:[value]});persist(field);render();}}));
  w.appendChild(tb);

  // Drag
  w.addEventListener('dragstart',(e)=>{
    dragData = { column, value, element: w, fromStack: null };
    w.classList.add('fs-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', value);
  });
  w.addEventListener('dragend',()=>{
    w.classList.remove('fs-dragging');
    clearAllHighlights();
    dragData = null;
  });

  return w;
}

// ─── Stack ──────────────────────────────────────────────────
function renderStack(field, column, stack, index) {
  const color = stack.color||dc(index), tc = cc(color);
  const outer = el('div',{class:'relative group/s',dataset:{gs:'stack',stackName:stack.name},draggable:'true'});
  const row = el('div',{class:'inline-flex items-center gap-1 rounded-full pl-3 pr-1.5 py-0.5',style:{backgroundColor:color}});

  // Color picker
  const cp=el('input',{type:'color',class:'absolute w-0 h-0 opacity-0',value:color});
  cp.addEventListener('input',e=>{stack.color=e.target.value;row.style.backgroundColor=e.target.value;persist(field);});
  row.addEventListener('dblclick',e=>{if(e.target===row)cp.click();}); row.appendChild(cp);

  // Title + edit
  const lbl=el('span',{class:'text-xs font-semibold whitespace-nowrap',textContent:stack.name,style:{color:tc}});
  const inp=el('input',{type:'text',class:'text-xs font-semibold border-0 focus:outline-none hidden whitespace-nowrap',value:stack.name,
    style:{color:tc,backgroundColor:'rgba(255,255,255,0.25)',borderRadius:'4px',padding:'0 4px',width:Math.max(3,stack.name.length*0.6)+'rem',caretColor:tc}});
  const ok=el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-green-500 text-white text-[7px] hover:bg-green-600 hidden flex-shrink-0',innerHTML:'<i class="fas fa-check"></i>'});
  const cx=el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-white/50 text-red-400 hover:text-red-600 text-[7px] hidden flex-shrink-0',innerHTML:'<i class="fas fa-times"></i>'});
  let tb;

  function showEdit(){lbl.classList.add('hidden');if(tb)tb.style.opacity='0';inp.classList.remove('hidden');ok.classList.remove('hidden');cx.classList.remove('hidden');inp.value=stack.name;inp.style.width=Math.max(3,stack.name.length*0.6)+'rem';requestAnimationFrame(()=>{inp.focus();inp.select();});}
  function hideEdit(){inp.classList.add('hidden');ok.classList.add('hidden');cx.classList.add('hidden');lbl.classList.remove('hidden');if(tb)tb.style.opacity='';}
  function commit(){const n=inp.value.trim();if(n){stack.name=n;lbl.textContent=n;outer.dataset.stackName=n;persist(field);}hideEdit();}
  ok.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();commit();});
  cx.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();hideEdit();});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape')hideEdit();});
  inp.addEventListener('input',()=>{inp.style.width=Math.max(3,inp.value.length*0.6)+'rem';});

  row.append(lbl,inp,ok,cx);

  // Inner pills (draggable individually)
  const pz=el('div',{class:'gs-inner inline-flex flex-wrap gap-1 items-center',dataset:{stackName:stack.name,column}});
  for(const v of stack.values){
    const ip = el('span',{class:'inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-white/90 text-gray-700 whitespace-nowrap cursor-grab select-none hover:bg-white transition-colors',textContent:v,dataset:{value:v},draggable:'true'});
    ip.addEventListener('dragstart',(e)=>{
      e.stopPropagation(); // Don't drag the whole stack
      dragData = { column, value: v, element: ip, fromStack: stack.name };
      ip.classList.add('fs-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', v);
    });
    ip.addEventListener('dragend',()=>{
      ip.classList.remove('fs-dragging');
      clearAllHighlights();
      dragData = null;
    });
    pz.appendChild(ip);
  }
  row.appendChild(pz);
  outer.appendChild(row);

  // Toolbar below
  tb = el('div',{class:'fs-tb'});
  tb.append(
    el('button',{class:'px-1.5 py-0.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50',innerHTML:'<i class="fas fa-pen text-[7px]"></i>',onClick:(e)=>{e.stopPropagation();showEdit();}}),
    el('button',{class:'px-1.5 py-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50',innerHTML:'<i class="fas fa-times text-[8px]"></i>',
      onClick:()=>{const s=currentMappings[column]||[];const i=s.indexOf(stack);if(i!==-1)s.splice(i,1);persist(field);render();}})
  );
  outer.appendChild(tb);

  // Drag the whole stack
  outer.addEventListener('dragstart',(e)=>{
    if (e.target !== outer && !row.contains(e.target)) return;
    // Only if not started by an inner pill
    if (dragData) return; // inner pill already set dragData
    dragData = { column, value: stack.name, element: outer, fromStack: null, isStack: true };
    outer.classList.add('fs-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', stack.name);
  });
  outer.addEventListener('dragend',()=>{
    outer.classList.remove('fs-dragging');
    clearAllHighlights();
    dragData = null;
  });

  return outer;
}

// ─── Helpers ────────────────────────────────────────────────
function removeVal(col,val){const ss=currentMappings[col]||[];for(let i=ss.length-1;i>=0;i--){const x=ss[i].values.indexOf(val);if(x!==-1){ss[i].values.splice(x,1);if(!ss[i].values.length)ss.splice(i,1);}}}
