// components/FieldSettings.js — Field-level group name standardization
// Uses custom pointer-based drag from utils/draggable.js

import { getActiveField } from '../core/state.js';
import { loadGroupMappings, saveGroupMappings, collectUniqueGroupValues } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { el, clear } from '../utils/dom.js';
import { PALETTES } from '../utils/color.js';
import { makeDraggable } from '../utils/draggable.js';

let containerEl = null, visible = false, currentMappings = {}, allUniqueValues = {};

export function init() {}
export function toggle(t) {
  containerEl = t; visible = !visible;
  if (visible) { render(); }
  else { if (containerEl) clear(containerEl); propagateChanges(); }
}
export function isVisible() { return visible; }
export function hide() { visible = false; if (containerEl) clear(containerEl); propagateChanges(); }
export function setupEvents() {}

function persist(f) {
  saveGroupMappings(f, currentMappings);
  emit(EVENTS.MAPPINGS_CHANGED, { field: f });
}

// Full propagation when settings panel closes
function propagateChanges() {
  emit(EVENTS.CASE_UPDATED, { field: getActiveField() });
}
function cc(h) { if(!h||h.length<7)return'#374151'; const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16); return(0.299*r+0.587*g+0.114*b)/255>0.55?'#374151':'#fff'; }
function dc(i) { return PALETTES.vibrant[i % PALETTES.vibrant.length]; }

// ─── Render ─────────────────────────────────────────────────
export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl);
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
  for (const c of cols) w.appendChild(renderSection(field, c));
  containerEl.appendChild(w);
}

// ─── Section ────────────────────────────────────────────────
function renderSection(field, column) {
  const vals = allUniqueValues[column]||[];
  const sec = el('div',{class:'mt-4'});
  sec.appendChild(el('div',{class:'flex items-center gap-2 py-1'},[
    el('span',{class:'text-xs font-medium text-gray-500 uppercase tracking-wider',textContent:column}),
    el('span',{class:'text-[10px] text-gray-300',textContent:`${vals.length}`}),
  ]));

  const items = el('div',{class:'flex flex-wrap gap-2 items-start mt-1',dataset:{column}});
  const stacks = currentMappings[column]||[];
  const asgn = new Set(); for(const s of stacks) for(const v of s.values) asgn.add(v);
  for(let i=0;i<stacks.length;i++) items.appendChild(renderStack(field,column,stacks[i],i));
  for(const v of vals.filter(v=>!asgn.has(v))) items.appendChild(renderPill(field, column, v));
  sec.appendChild(items);

  // Wire up draggable
  setTimeout(() => {
    makeDraggable(items, {
      itemSelector: '[data-gs]',
      innerSelector: '.gs-inner [data-value]',
      canStack: (drag, target) => {
        return drag.dataset.gs === 'pill' && (target.dataset.gs === 'pill' || target.dataset.gs === 'stack');
      },
      onStack: (drag, target) => {
        const dragVal = drag.dataset.value;
        if (target.dataset.gs === 'pill') {
          const targetVal = target.dataset.value;
          removeVal(column, dragVal); removeVal(column, targetVal);
          if (!currentMappings[column]) currentMappings[column] = [];
          currentMappings[column].push({ name: targetVal, values: [targetVal, dragVal] });
        } else if (target.dataset.gs === 'stack') {
          removeVal(column, dragVal);
          const st = (currentMappings[column]||[]).find(s => s.name === target.dataset.stackName);
          if (st && !st.values.includes(dragVal)) st.values.push(dragVal);
        }
        persist(field); render();
      },
      onInnerDragOut: (value, fromStackName, drop) => {
        // Remove the pill from its source stack
        removeVal(column, value);
        // If dropped onto another stack, add it there
        if (drop && drop.mode === 'ontop' && drop.target.dataset.gs === 'stack') {
          const st = (currentMappings[column]||[]).find(s => s.name === drop.target.dataset.stackName);
          if (st && !st.values.includes(value)) st.values.push(value);
        }
        // If dropped onto a bare pill, create new stack
        if (drop && drop.mode === 'ontop' && drop.target.dataset.gs === 'pill') {
          const tv = drop.target.dataset.value;
          removeVal(column, tv);
          if (!currentMappings[column]) currentMappings[column] = [];
          currentMappings[column].push({ name: tv, values: [tv, value] });
        }
        persist(field); render();
      },
      onReorder: (drag, target, position) => {
        persist(field); render();
      },
    });
  }, 0);

  return sec;
}

// ─── Bare pill ──────────────────────────────────────────────
function renderPill(field, column, value) {
  const w = el('div',{class:'relative inline-block',dataset:{gs:'pill',value}});
  w.appendChild(el('span',{
    class:'inline-flex items-center px-3 py-1.5 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap',
    textContent:value,
  }));
  const tb = el('div',{
    class:'fs-tb absolute top-full right-0 mt-0.5 flex items-center bg-white border border-gray-200 rounded shadow-sm opacity-0 transition-opacity z-10 overflow-hidden',
  });
  tb.appendChild(el('button',{class:'px-1.5 py-0.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 text-[7px]',innerHTML:'<i class="fas fa-pen"></i>',
    onClick:(e)=>{e.stopPropagation();if(!currentMappings[column])currentMappings[column]=[];currentMappings[column].push({name:value,color:dc(currentMappings[column].length),values:[value]});persist(field);render();}}));
  w.appendChild(tb);
  // Show toolbar on hover
  w.addEventListener('mouseenter',()=>{tb.style.opacity='1';});
  w.addEventListener('mouseleave',()=>{tb.style.opacity='';});
  return w;
}

// ─── Stack ──────────────────────────────────────────────────
function renderStack(field, column, stack, index) {
  const color=stack.color||dc(index), tc=cc(color);
  const outer = el('div',{class:'relative inline-block',dataset:{gs:'stack',stackName:stack.name,value:stack.name}});
  const row = el('div',{
    class:'inline-flex items-center gap-1.5 rounded-full pl-3.5 pr-2.5 py-1.5 cursor-grab select-none',
    style:{backgroundColor:color},
  });

  // Color picker
  const cp=el('input',{type:'color',class:'absolute w-0 h-0 opacity-0',value:color});
  cp.addEventListener('input',e=>{stack.color=e.target.value;row.style.backgroundColor=e.target.value;persist(field);});
  row.addEventListener('dblclick',e=>{if(e.target===row)cp.click();}); row.appendChild(cp);

  // Title + edit
  const lbl=el('span',{class:'text-xs font-semibold whitespace-nowrap',textContent:stack.name,style:{color:tc}});
  const inp=el('input',{type:'text',class:'text-xs font-semibold border-0 focus:outline-none hidden whitespace-nowrap',value:stack.name,
    style:{color:tc,backgroundColor:'rgba(255,255,255,0.25)',borderRadius:'4px',padding:'0 4px',width:Math.max(3,stack.name.length*0.6)+'rem',caretColor:tc}});
  const ok=el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-green-500 text-white text-[7px] hover:bg-green-600 hidden flex-shrink-0',innerHTML:'<i class="fas fa-check"></i>'});
  const cx=el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[7px] hover:bg-red-600 hidden flex-shrink-0',innerHTML:'<i class="fas fa-times"></i>'});
  let tb;

  function showEdit(){lbl.classList.add('hidden');if(tb)tb.style.opacity='0';inp.classList.remove('hidden');ok.classList.remove('hidden');cx.classList.remove('hidden');inp.value=stack.name;inp.style.width=Math.max(3,stack.name.length*0.6)+'rem';requestAnimationFrame(()=>{inp.focus();inp.select();});}
  function hideEdit(){inp.classList.add('hidden');ok.classList.add('hidden');cx.classList.add('hidden');lbl.classList.remove('hidden');if(tb)tb.style.opacity='';}
  function commit(){const n=inp.value.trim();if(n){stack.name=n;lbl.textContent=n;outer.dataset.stackName=n;persist(field);}hideEdit();}
  ok.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();commit();});
  cx.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();hideEdit();});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape')hideEdit();});
  inp.addEventListener('input',()=>{inp.style.width=Math.max(3,inp.value.length*0.6)+'rem';});

  row.append(lbl,inp,ok,cx);

  // Inner pills (wrapped for drag detection)
  const pz = el('div',{class:'gs-inner inline-flex flex-wrap gap-1 items-center'});
  for(const v of stack.values){
    pz.appendChild(el('span',{
      class:'inline-flex items-center px-2.5 py-0.5 text-xs rounded-full bg-white/80 text-gray-700 whitespace-nowrap border border-white/40 cursor-grab select-none',
      textContent:v, dataset:{value:v},
    }));
  }
  row.appendChild(pz);

  outer.appendChild(row);

  // Toolbar below right
  tb = el('div',{
    class:'fs-tb absolute top-full right-0 mt-0.5 flex items-center bg-white border border-gray-200 rounded shadow-sm opacity-0 hover:opacity-100 transition-opacity z-10 overflow-hidden',
  });
  tb.append(
    el('button',{class:'px-1.5 py-0.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 text-[7px]',innerHTML:'<i class="fas fa-pen"></i>',onClick:(e)=>{e.stopPropagation();showEdit();}}),
    el('button',{class:'px-1.5 py-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50 text-[8px]',innerHTML:'<i class="fas fa-times"></i>',
      onClick:()=>{const s=currentMappings[column]||[];const i=s.indexOf(stack);if(i!==-1)s.splice(i,1);persist(field);render();}})
  );
  outer.appendChild(tb);
  outer.addEventListener('mouseenter',()=>{tb.style.opacity='1';});
  outer.addEventListener('mouseleave',()=>{tb.style.opacity='';});

  return outer;
}

// ─── Helpers ────────────────────────────────────────────────
function removeVal(col,val){const ss=currentMappings[col]||[];for(let i=ss.length-1;i>=0;i--){const x=ss[i].values.indexOf(val);if(x!==-1){ss[i].values.splice(x,1);if(!ss[i].values.length)ss.splice(i,1);}}}
