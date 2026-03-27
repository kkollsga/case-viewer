// components/FieldSettings.js — Field-level group name standardization

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

// ─── Styles ─────────────────────────────────────────────────
let si = false;
function injectStyles() {
  if (si) return; si = true;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
    .fs-ghost { width:2px!important; min-width:2px!important; max-width:2px!important;
      height:24px!important; background:#4338ca!important; border-radius:1px!important;
      padding:0!important; margin:0 1px!important; opacity:1!important;
      overflow:hidden!important; border:none!important; box-shadow:0 0 6px rgba(67,56,202,0.4)!important; }
    .fs-ghost * { display:none!important; }
    .fs-drag { opacity:0.25!important; filter:grayscale(1)!important; }
    .fs-ontop { outline:2.5px solid #4338ca!important; outline-offset:0!important; border-radius:9999px!important; }
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
  const order = currentMappings.__groupOrder || Object.keys(allUniqueValues);
  const ac = Object.keys(allUniqueValues);
  const cols = [...order.filter(c=>ac.includes(c)), ...ac.filter(c=>!order.includes(c))];
  const secs = el('div',{class:'space-y-4'});
  for (const c of cols) secs.appendChild(renderSection(field, c));
  w.appendChild(secs);
  containerEl.appendChild(w);
  setTimeout(()=>{ if(typeof Sortable==='undefined')return;
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
  for(const v of vals.filter(v=>!asgn.has(v))) items.appendChild(renderPill(v));
  sec.appendChild(items);

  setTimeout(()=>{
    if(typeof Sortable==='undefined')return;
    // Main sortable
    Sortable.create(items,{
      animation:0, group:{name:`c-${column}`,pull:false,put:[`i-${column}`]},
      ghostClass:'fs-ghost', dragClass:'fs-drag', filter:'.fs-tb',
      onAdd:()=>fullRebuild(field,column,items),
      onMove:(evt)=>{
        // On-top detection: if moving over a bare pill, highlight it
        const rel = evt.related;
        clearHighlights(items);
        if(rel && rel.dataset.gs==='pill' && evt.dragged.dataset.gs==='pill' && rel!==evt.dragged){
          rel.classList.add('fs-ontop');
          return false; // prevent sortable insertion — we'll handle in onEnd
        }
        if(rel && rel.dataset.gs==='stack' && evt.dragged.dataset.gs==='pill'){
          rel.classList.add('fs-ontop');
          return false;
        }
        return true; // allow normal between insertion
      },
      onEnd:(evt)=>{
        clearHighlights(items);
        // Check if something was highlighted (on-top drop)
        const drag = evt.item;
        const rect = drag.getBoundingClientRect();
        let onTop = null;
        for(const ch of items.children){
          if(ch===drag) continue;
          const r = ch.getBoundingClientRect();
          const ox = Math.max(0,Math.min(rect.right,r.right)-Math.max(rect.left,r.left));
          const oy = Math.max(0,Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top));
          if(ox>r.width*0.3 && oy>r.height*0.3){ onTop=ch; break; }
        }
        if(onTop && drag.dataset.gs==='pill' && onTop.dataset.gs==='pill'){
          const dv=drag.dataset.value, tv=onTop.dataset.value;
          removeVal(column,dv); removeVal(column,tv);
          if(!currentMappings[column])currentMappings[column]=[];
          currentMappings[column].push({name:tv,values:[tv,dv]});
          persist(field); render();
        } else if(onTop && drag.dataset.gs==='pill' && onTop.dataset.gs==='stack'){
          const dv=drag.dataset.value; removeVal(column,dv);
          const st=(currentMappings[column]||[]).find(s=>s.name===onTop.dataset.stackName);
          if(st&&!st.values.includes(dv)) st.values.push(dv);
          persist(field); render();
        } else { fullRebuild(field,column,items); }
      },
    });
    // Inner sortables
    for(const pz of items.querySelectorAll('.gs-inner')){
      Sortable.create(pz,{
        animation:0, group:{name:`i-${column}`,pull:true,put:true},
        ghostClass:'fs-ghost', dragClass:'fs-drag',
        onEnd:()=>fullRebuild(field,column,items),
        onAdd:()=>fullRebuild(field,column,items),
        onRemove:(evt)=>{
          if(evt.from.children.length===0){ const se=evt.from.closest('[data-gs=stack]'); if(se){const nm=se.dataset.stackName;const ss=currentMappings[column]||[];const ix=ss.findIndex(s=>s.name===nm);if(ix!==-1)ss.splice(ix,1);se.remove();} }
          fullRebuild(field,column,items);
        },
      });
    }
  },50);
  return sec;
}

function clearHighlights(container) {
  container.querySelectorAll('.fs-ontop').forEach(e=>e.classList.remove('fs-ontop'));
}

// ─── Bare pill ──────────────────────────────────────────────
function renderPill(value) {
  const w = el('div',{class:'relative group/p',dataset:{gs:'pill',value}});
  w.appendChild(el('span',{class:'inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap',textContent:value}));
  // Toolbar below bottom-right
  const tb = el('div',{class:'fs-tb'});
  tb.appendChild(el('button',{class:'px-1.5 py-0.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50',innerHTML:'<i class="fas fa-pen text-[7px]"></i>',
    onClick:(e)=>{e.stopPropagation();const f=getActiveField(),c=w.closest('.gs-items')?.dataset.column;if(!f||!c)return;if(!currentMappings[c])currentMappings[c]=[];currentMappings[c].push({name:value,color:dc(currentMappings[c].length),values:[value]});persist(f);render();}}));
  w.appendChild(tb);
  return w;
}

// ─── Stack ──────────────────────────────────────────────────
function renderStack(field, column, stack, index) {
  const color=stack.color||dc(index), tc=cc(color);
  const outer = el('div',{class:'relative group/s',dataset:{gs:'stack',stackName:stack.name}});
  const row = el('div',{class:'inline-flex items-center gap-1 rounded-full pl-3 pr-1.5 py-0.5',style:{backgroundColor:color}});

  // Color picker
  const cp=el('input',{type:'color',class:'absolute w-0 h-0 opacity-0',value:color});
  cp.addEventListener('input',e=>{stack.color=e.target.value;row.style.backgroundColor=e.target.value;persist(field);});
  row.addEventListener('dblclick',e=>{if(e.target===row)cp.click();}); row.appendChild(cp);

  // Title
  const lbl=el('span',{class:'text-xs font-semibold whitespace-nowrap',textContent:stack.name,style:{color:tc}});
  const inp=el('input',{type:'text',class:'text-xs font-semibold border-0 focus:outline-none hidden whitespace-nowrap',value:stack.name,
    style:{color:tc,backgroundColor:'rgba(255,255,255,0.25)',borderRadius:'4px',padding:'0 4px',width:Math.max(3,stack.name.length*0.6)+'rem',caretColor:tc}});
  const ok=el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-green-500 text-white text-[7px] hover:bg-green-600 hidden flex-shrink-0',innerHTML:'<i class="fas fa-check"></i>'});
  const cx=el('button',{class:'w-4 h-4 flex items-center justify-center rounded-full bg-white/50 text-red-400 hover:text-red-600 text-[7px] hidden flex-shrink-0',innerHTML:'<i class="fas fa-times"></i>'});

  function showEdit(){lbl.classList.add('hidden');tb.style.opacity='0';inp.classList.remove('hidden');ok.classList.remove('hidden');cx.classList.remove('hidden');inp.value=stack.name;inp.style.width=Math.max(3,stack.name.length*0.6)+'rem';requestAnimationFrame(()=>{inp.focus();inp.select();});}
  function hideEdit(){inp.classList.add('hidden');ok.classList.add('hidden');cx.classList.add('hidden');lbl.classList.remove('hidden');tb.style.opacity='';}
  function commit(){const n=inp.value.trim();if(n){stack.name=n;lbl.textContent=n;outer.dataset.stackName=n;persist(field);}hideEdit();}
  ok.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();commit();});
  cx.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();hideEdit();});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape')hideEdit();});
  inp.addEventListener('input',()=>{inp.style.width=Math.max(3,inp.value.length*0.6)+'rem';});

  row.append(lbl,inp,ok,cx);

  // Inner pills
  const pz=el('div',{class:'gs-inner inline-flex flex-wrap gap-1 items-center',dataset:{stackName:stack.name,column}});
  for(const v of stack.values) pz.appendChild(el('span',{class:'inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-white/90 text-gray-700 whitespace-nowrap cursor-grab select-none hover:bg-white transition-colors',textContent:v,dataset:{value:v}}));
  row.appendChild(pz);
  outer.appendChild(row);

  // Toolbar below bottom-right
  const tb=el('div',{class:'fs-tb'});
  tb.append(
    el('button',{class:'px-1.5 py-0.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50',innerHTML:'<i class="fas fa-pen text-[7px]"></i>',onClick:(e)=>{e.stopPropagation();showEdit();}}),
    el('button',{class:'px-1.5 py-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50',innerHTML:'<i class="fas fa-times text-[8px]"></i>',
      onClick:()=>{const s=currentMappings[column]||[];const i=s.indexOf(stack);if(i!==-1)s.splice(i,1);persist(field);render();}})
  );
  outer.appendChild(tb);
  return outer;
}

// ─── Helpers ────────────────────────────────────────────────
function removeVal(col,val){const ss=currentMappings[col]||[];for(let i=ss.length-1;i>=0;i--){const x=ss[i].values.indexOf(val);if(x!==-1){ss[i].values.splice(x,1);if(!ss[i].values.length)ss.splice(i,1);}}}
function fullRebuild(field,column,container){
  const ns=[];
  for(const ch of container.children){
    if(ch.dataset.gs==='stack'){const pz=ch.querySelector('.gs-inner');const pills=pz?Array.from(pz.children).map(p=>p.dataset.value).filter(Boolean):[];if(!pills.length)continue;const nm=ch.dataset.stackName;const ex=(currentMappings[column]||[]).find(s=>s.name===nm);ns.push({name:ex?.name||pills[0],color:ex?.color,values:pills});}
  }
  currentMappings[column]=ns; persist(field); render();
}
