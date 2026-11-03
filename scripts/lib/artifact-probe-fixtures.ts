/**
 * Fixtures for `verify:artifact-probes` fixture mode.
 *
 * Fixture mode exists to prove the probe battery can *tell the difference*. A battery that reports
 * "no findings" over a document with a stale export is worse than no battery, because "no findings"
 * reads as reassurance. So each knob below is a single deliberate defect, and the gate asserts two
 * things for every one of them: the matching probe flags it, and the probes that should not care stay
 * clean. A knob that flips two probes at once is a knob that measures nothing specific.
 *
 * The knobs are not arbitrary. Each one is the shape of a defect a person found in a generated
 * application (KI-88 stale published output, KI-89 seed domain, KI-90 undo across reload) or a shape
 * the beta's own review asked to have measured (KI-91 narrow viewport, invalid input handling).
 */

export interface FixtureKnobs {
  /**
   * What happens to the thing the app hands over when the state changes:
   * `refresh` — regenerating refreshes the published region, so both publish paths stay in step;
   * `stale-copy` — Export still writes what is on screen, but nothing rewrites the region on its own,
   * so a **copy without a re-export** delivers the previous palette. This is exactly KI-88's shape,
   * and it is why the two publish sequences are driven separately: an earlier draft that only re-
   * pressed Export reported this document clean;
   * `frozen` — Export writes the palette captured at load, so both publish paths hand over old output.
   */
  publish_mode: 'refresh' | 'stale-copy' | 'frozen';
  /** `wide`: the seed is mixed from its digits. `wrap32`: the seed is folded into 32 bits. */
  seed_mode: 'wide' | 'wrap32';
  /** `restores`: Undo puts the discarded state back. `noop`: Undo is offered and does nothing. */
  undo_mode: 'restores' | 'noop';
  /** `none`: the artifact offers no Undo control at all. */
  undo_control: boolean;
  /** `state_and_undo` / `state_only` / `none`: what a reload brings back. */
  persistence_mode: 'state_and_undo' | 'state_only' | 'none';
  /** `fluid`: the document fits 390px. `fixed`: it demands 900px and scrolls sideways. */
  layout: 'fluid' | 'fixed';
  /** `guarded`: invalid input gets a message. `nan`: invalid input reaches the rendered output. */
  invalid_mode: 'guarded' | 'nan';
  /** Whether the document is asked to do something at phone width at all. */
  viewport_probe: boolean;
}

export const CLEAN_KNOBS: FixtureKnobs = {
  publish_mode: 'refresh',
  seed_mode: 'wide',
  undo_mode: 'restores',
  undo_control: true,
  persistence_mode: 'state_and_undo',
  layout: 'fluid',
  invalid_mode: 'guarded',
  viewport_probe: true,
};

/** Labelled single-defect variants: exactly one knob differs from `CLEAN_KNOBS`. */
export const DEFECTIVE_KNOBS: Array<{ label: string; knobs: FixtureKnobs }> = [
  {
    label: 'stale-copy-export',
    knobs: { ...CLEAN_KNOBS, publish_mode: 'stale-copy' },
  },
  {
    label: 'frozen-export',
    knobs: { ...CLEAN_KNOBS, publish_mode: 'frozen' },
  },
  {
    label: 'wrap32-seed',
    knobs: { ...CLEAN_KNOBS, seed_mode: 'wrap32' },
  },
  {
    label: 'undo-does-nothing',
    knobs: { ...CLEAN_KNOBS, undo_mode: 'noop' },
  },
  {
    label: 'no-undo-control',
    knobs: { ...CLEAN_KNOBS, undo_control: false },
  },
  {
    label: 'reload-loses-undo',
    knobs: { ...CLEAN_KNOBS, persistence_mode: 'state_only' },
  },
  {
    label: 'fixed-width-layout',
    knobs: { ...CLEAN_KNOBS, layout: 'fixed' },
  },
  {
    label: 'nan-renders',
    knobs: { ...CLEAN_KNOBS, invalid_mode: 'nan' },
  },
];

const STYLE = (knobs: FixtureKnobs): string => `
 body{font:14px system-ui;margin:16px;${knobs.layout === 'fixed' ? 'min-width:900px;' : ''}}
 .row{display:flex;gap:8px;flex-wrap:wrap}
 .sw{display:inline-block;width:56px;height:34px;border:1px solid #888;margin-right:4px}
 textarea{width:min(100%,520px);height:74px}
 button{padding:8px 12px}
`;

const SCRIPT = (knobs: FixtureKnobs): string => `
var seedEl=document.getElementById('seed');
var shown=document.getElementById('shown');
var box=document.getElementById('out');
var statusEl=document.getElementById('status');
var undoBtn=document.getElementById('undo');
var colours=[];
var loadPalette=generate('1');
var previous=null;
var storage=${knobs.persistence_mode === 'none' ? 'null' : 'localStorage'};

function mix(value){
${
  knobs.seed_mode === 'wrap32'
    ? `  var n=parseInt(value,10)>>>0; return Math.imul(n,2654435761)>>>0;`
    : `  var s=String(value),h=0; for(var k=0;k<s.length;k++){h=(h*31+s.charCodeAt(k))>>>0;} return h;`
}
}

function generate(value){
  var h=mix(value);
  var out=[];
  for(var i=0;i<5;i++){
    h=(h+0x9e3779b1+i*7919)>>>0;
    out.push('#'+(h%0xffffff).toString(16).padStart(6,'0'));
  }
  return out;
}

function paint(list){
  var html='';
  for(var i=0;i<list.length;i++){
    html+='<span class="sw" style="background:'+list[i]+'"></span>'+list[i]+' ';
  }
  shown.innerHTML=html;
}

function remember(){
  if(!storage) return;
  try{
    storage.setItem('probe-state',JSON.stringify({
      colours:colours,
      undo:${knobs.persistence_mode === 'state_and_undo' ? 'previous' : 'null'}
    }));
  }catch(err){}
}

function restore(){
  if(!storage) return null;
  try{ return JSON.parse(storage.getItem('probe-state')||'null'); }catch(err){ return null; }
}

document.getElementById('generate').onclick=function(){
  var raw=seedEl.value;
  // publish_mode=${knobs.publish_mode}: does a state change refresh what was already handed over?

  var parsed=parseInt(raw,10);
${
  knobs.invalid_mode === 'guarded'
    ? `  if(!Number.isFinite(parsed)||String(raw).trim()===''){ statusEl.textContent='Enter a number for the seed.'; return; }`
    : `  var bad=String(parsed);`
}
  colours=generate(raw);
  paint(colours);
${knobs.invalid_mode === 'nan' ? "  shown.insertAdjacentHTML('beforeend','<span id=\"leak\">'+bad+'</span>');\n" : ''}${knobs.publish_mode === 'refresh' ? "  box.value=colours.join(' ');\n" : ''}  statusEl.textContent='Generated from '+raw+'.';
  remember();
};

document.getElementById('export').onclick=function(){
  box.value=(${knobs.publish_mode === 'frozen' ? 'loadPalette' : 'colours'}).join(' ');
  statusEl.textContent='Exported the palette as CSS custom properties.';
};

document.getElementById('copy').onclick=function(){
  var text=box.value;
  if(navigator.clipboard){ navigator.clipboard.writeText(text); }
  statusEl.textContent='Copied the exported CSS to your clipboard.';
};

document.getElementById('clear').onclick=function(){
  previous=colours.slice();
  colours=[];
  paint(colours);
${knobs.undo_control ? '  undoBtn.hidden=false;\n' : ''}  statusEl.textContent='Palette cleared.';
  remember();
};
${
  knobs.undo_control
    ? `undoBtn.hidden=true;
undoBtn.onclick=function(){
${
  knobs.undo_mode === 'restores'
    ? `  if(previous){ colours=previous.slice(); previous=null; paint(colours); undoBtn.hidden=true; statusEl.textContent='Clear undone.'; }`
    : `  statusEl.textContent='Undo pressed.';`
}
  remember();
};`
    : ''
}

var saved=restore();
if(saved&&saved.colours){
  colours=saved.colours;
  paint(colours);
${knobs.persistence_mode === 'state_and_undo' ? `  if(saved.undo&&undoBtn){ previous=saved.undo; undoBtn.hidden=false; }\n` : ''}
}else{
  colours=generate('1');
  paint(colours);
}
`;

/** One small vanilla document, laid out from the knobs. No dependencies, no network, no provider. */
export function probeFixture(knobs: FixtureKnobs, label: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${label}</title><style>${STYLE(knobs)}</style></head><body>
<h1>Probe fixture: ${label}</h1>
<label for="seed">Seed</label><input id="seed" type="number" value="1">
<div class="row">
<button type="button" id="generate">Generate palette</button>
<button type="button" id="export">Export CSS</button>
<button type="button" id="copy">Copy CSS</button>
<button type="button" id="clear">Clear palette</button>
${knobs.undo_control ? '<button type="button" id="undo" hidden>Undo clear</button>' : ''}
</div>
<div id="shown"></div>
<textarea id="out" aria-label="exported CSS" readonly></textarea>
<p id="status" role="status"></p>
<script>${SCRIPT(knobs)}</script>
</body></html>`;
}

/** Accessible names the fixture uses, so the gate drives the same names a user would read. */
export const FIXTURE_CONTROLS = {
  fill: { label: 'Seed', value: '77' },
  invalid_value: 'abc',
  regenerate: 'Generate palette',
  publish: 'Export CSS',
  copy: 'Copy CSS',
  destructive: 'Clear palette',
  undo: 'Undo clear',
} as const;
