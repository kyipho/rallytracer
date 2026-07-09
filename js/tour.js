// ---------- guided tour ----------
// Self-contained first-run walkthrough. Builds its own overlay DOM at open() time and tears it
// fully down on close (skip / Escape / finish) — index.html carries no tour markup at rest.
//
// This module owns Task A (framework): overlay shell, step engine, controls, keyboard isolation.
// It leaves two documented, empty hooks for later work:
//   - #tourMedia (left pane)  — Task C wires a looping YouTube clip in here.
//   - #tourCourt (right pane) — Task B builds the demo court SVG + zone tap handlers in here.
// See the function docs below (renderStep, tourZoneTap, key routing) for the extension surface.
import { saveTourSeen } from './persistence.js';

// TOUR_CLIP: the real-match clip the tour walks through — only ~43s-50s of this video is used.
// Steps (and seq items) carry their own {from,to} segments below; each becomes its own embed URL
// (see segmentSrc). start/end here just document the overall window.
export var TOUR_CLIP = { videoId:'sG9p_nd_sDU', start:43, end:50 };

// ---------- step data ----------
// Each step: {title, html, video:{from,to}|null, expect, onEnter}.
// video:{from,to} is a clip segment: on entering that phase the player loads and plays from
// `from` and stops at `to` (armed endSeconds), waiting there for the user's action.
// Seq items may carry their own video segment, consumed as the sequence progresses.
// expect shapes:
//   null                          — info step, "next" advances unconditionally
//   {type:'zone', zones:[...]}    — advance when tourZoneTap() is called with a listed zone
//   {type:'key', keys:[...]}      — advance when one of these keys is pressed (or its keycap clicked)
//   {type:'seq', items:[...]}     — items are zone/key expects consumed in order
// onEnter(step): optional hook called every time this step becomes current (after render), so
// Task B/C can start pulsing zones, cue video segments, etc.
var steps = [
  {
    title:'Welcome',
    html:'RallyTracer allows you to tag shot-by-shot data in a squash match. In the next page, the player on the left will show a rally, and you will tag it on the right.',
    video:null, expect:null, onEnter:onStepEnter
  },
  {
    title:'The serve',
    html:'Tap the <b>side</b> the serve is struck from.',
    video:{from:43, to:44.5},
    expect:{type:'zone', zones:['FR','BR']},
    onEnter:onStepEnter
  },
  {
    title:'Tagging strikes',
    html:'As each shot is hit, tap the zone where the ball is <b>struck</b> &mdash; not where it lands. The clip in this guide pauses after each shot; your tap rolls it on.',
    expect:{type:'seq', items:[
      {type:'zone', zones:['BL'], video:{from:45, to:46.4}},
      {type:'zone', zones:['BL'], video:{from:47, to:47.7}},
      {type:'zone', zones:['BL'], video:{from:48, to:48.7}}
    ]},
    video:null,
    onEnter:onStepEnter
  },
  {
    title:'Ending a rally: winner & errors',
    html:'This rally ends in a <b>winner</b>: press <span class="keycap">w</span>, then tap front-right &mdash; where the ball <b>landed</b>. Errors work the same way with <span class="keycap">u</span> (unforced) or <span class="keycap">f</span> (forced).',
    expect:{type:'seq', items:[
      {type:'key', keys:['w'], video:{from:48, to:50}},
      {type:'zone', zones:['FR']}
    ]},
    video:null,
    onEnter:onStepEnter
  },
  {
    title:'Ending a rally: decisions',
    html:'Interference? <span class="keycap">n</span> = no let, <span class="keycap">l</span> = let, <span class="keycap">s</span> = stroke. Stroke and no-let ask which player the call goes to.',
    video:null,
    expect:{type:'key', keys:['n','l','s']},
    onEnter:onStepEnter
  },
  {
    title:'After the match: analytics',
    html:'Everything you tag feeds the <b>Live analytics</b> panel below the court &mdash; <b>Tallies</b> of winners and errors, <b>Court</b> maps of where shots are struck and land, <b>Rallies</b> lengths and endings, and common shot <b>Patterns</b>. A taste of what a tagged match looks like:'+
      '<div class="tourStats" aria-hidden="true">'+
        '<span class="tsH">tallies</span><span class="tsH">A</span><span class="tsH">B</span>'+
        '<span>Winners</span><span class="tsV">14</span><span class="tsV">9</span>'+
        '<span>Unforced errors</span><span class="tsV">7</span><span class="tsV">12</span>'+
        '<span>Points won serving</span><span class="tsV">18/31 (58%)</span><span class="tsV">12/28 (43%)</span>'+
        '<span>Volley rate</span><span class="tsV">22%</span><span class="tsV">31%</span>'+
        '<span>Avg rally length</span><span class="tsV">8.2</span><span class="tsV">&nbsp;</span>'+
      '</div>'+
      '<div class="tourStats tsSeq" aria-hidden="true">'+
        '<span class="tsH">A &mdash; winning sequences</span>'+
        '<span>A BL→FR → A FR→FL <i class="cnt">×4</i></span>'+
        '<span>A BR→FL <i class="cnt">×3</i></span>'+
        '<span class="tsH">B &mdash; setup shots before winners</span>'+
        '<span>FL→BR <i class="cnt">×3</i></span>'+
      '</div>',
    video:null, expect:null, hideCourt:true, onEnter:onStepEnter
  },
  {
    title:'Done',
    html:'Press <b>z</b> to undo, click any tape row to review or edit it, and the <b>?</b> button reopens this tour any time.',
    video:null, expect:null, onEnter:onStepEnter
  }
];

// ---------- module state ----------
var cursor = 0;
var overlayEl = null;
var tourPlayer = null; // the tour's own YT.Player, independent of js/youtube.js's module-private one
var playerReady = false;
var pendingSeg = null; // segment requested before the player finished initializing
var pollTimer = null;  // watches getCurrentTime() to pause just before the segment's `to` mark
var activeSeg = null;  // segment currently loaded (its endSeconds is armed in the player)
var holding = false;   // true once the current segment should be parked — any PLAYING state that
                       // sneaks through while holding (seek races, end-screen restarts) is re-paused
var readyWatch = null; // fallback readiness detector — onReady has proven unreliable here
var keyHandler = null;
var seqProgress = 0; // how many items of a {type:'seq'} expect have been satisfied on the current step
var zoneFillEls = {}; // zone code -> demo-court fill <rect>, built by buildDemoCourt()
var ZONE_LIST = ['FL','FR','BL','BR'];

// ---------- public API ----------
export function openTour(){
  if(overlayEl) return; // already open
  cursor = 0;
  seqProgress = 0;
  buildOverlay();
  buildDemoCourt();
  installKeyIsolation();
  window.addEventListener('resize', updateHand);
  renderStep();
}

function closeTour(){
  saveTourSeen();
  teardownKeyIsolation();
  window.removeEventListener('resize', updateHand);
  stopSegmentPoll();
  if(readyWatch){ clearInterval(readyWatch); readyWatch = null; }
  pendingSeg = null;
  activeSeg = null;
  holding = false;
  playerReady = false;
  if(tourPlayer){ try{ tourPlayer.destroy(); }catch(_){} tourPlayer = null; }
  if(overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
  overlayEl = null;
}

// tourZoneTap(z): called by the demo court's click handlers (Task B) when the user taps a zone
// (z is a zone code like 'FL'/'FR'/'BL'/'BR'). Returns true if the tap satisfied the current
// step's expect (and the step/sequence advanced), false otherwise (caller should flash an error).
export function tourZoneTap(z){
  var step = steps[cursor];
  if(!step || !step.expect) return false;
  var exp = step.expect;
  if(exp.type==='zone'){
    if(exp.zones.indexOf(z)>=0){ advance(); return true; }
    return false;
  }
  if(exp.type==='seq'){
    var item = exp.items[seqProgress];
    if(item && item.type==='zone' && item.zones.indexOf(z)>=0){
      seqProgress++;
      if(seqProgress>=exp.items.length){ advance(); } else { onStepEnter(step); }
      return true;
    }
    return false;
  }
  return false;
}

// routeTourKey(key): called from the capture-phase keydown handler below with a normalized
// lowercase key. Returns true if it satisfied the current step's expect (and advanced).
function routeTourKey(key){
  var step = steps[cursor];
  if(!step || !step.expect) return false;
  var exp = step.expect;
  if(exp.type==='key'){
    if(exp.keys.indexOf(key)>=0){ advance(); return true; }
    return false;
  }
  if(exp.type==='seq'){
    var item = exp.items[seqProgress];
    if(item && item.type==='key' && item.keys.indexOf(key)>=0){
      seqProgress++;
      if(seqProgress>=exp.items.length){ advance(); } else { onStepEnter(step); }
      return true;
    }
    return false;
  }
  return false;
}

function advance(){
  if(cursor < steps.length-1){ cursor++; seqProgress=0; renderStep(); }
  else { closeTour(); }
}
function back(){
  if(cursor>0){ cursor--; seqProgress=0; renderStep(); }
}

// ---------- DOM ----------
function buildOverlay(){
  overlayEl = document.createElement('div');
  overlayEl.className = 'tourOverlay';
  overlayEl.innerHTML =
    '<div class="tourCard">' +
      '<div class="tourPane tourPaneMedia">' +
        '<div id="tourMedia" class="tourMedia"><span class="tourMediaPlaceholder">demo clip coming soon</span></div>' +
      '</div>' +
      '<div class="tourPane tourPaneStep">' +
        '<div class="tourStepTitle" id="tourStepTitle"></div>' +
        '<div class="tourStepBody" id="tourStepBody"></div>' +
        '<div id="tourCourt" class="tourCourt"></div>' +
        '<div class="tourDots" id="tourDots"></div>' +
        '<div class="tourControls">' +
          '<button class="btn gho" id="tourSkip">Skip tour</button>' +
          '<span style="flex:1 1 auto"></span>' +
          '<button class="btn gho" id="tourBack">Back</button>' +
          '<button class="btn pri" id="tourNext">Next</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="tourHand" id="tourHand" aria-hidden="true">👆</div>';
  document.body.appendChild(overlayEl);
  // the card scrolls on short viewports; keep the hand glued to its target
  overlayEl.querySelector('.tourCard').addEventListener('scroll', updateHand);
  overlayEl.querySelector('#tourSkip').addEventListener('click', closeTour);
  overlayEl.querySelector('#tourBack').addEventListener('click', back);
  overlayEl.querySelector('#tourNext').addEventListener('click', function(){
    var step = steps[cursor];
    if(!step.expect) advance(); // info steps: next always advances
    // steps with an expect wait for the real action (zone tap / key) — "next" is a no-op there,
    // matching the plan's "do it" style; Task B/C may relax this per-step if desired.
  });
}

// renderStep(): re-renders the title/body/dots/controls for the current cursor position and
// invokes steps[cursor].onEnter(step) if present. Call this after mutating `cursor` directly if
// ever needed from outside (not expected in Task A/B/C — prefer advance()/back()).
export function renderStep(){
  if(!overlayEl) return;
  var step = steps[cursor];
  overlayEl.querySelector('#tourStepTitle').textContent = step.title;
  overlayEl.querySelector('#tourStepBody').innerHTML = step.html;
  // keycaps double as buttons — clicking one counts as pressing the key
  Array.prototype.forEach.call(overlayEl.querySelectorAll('#tourStepBody .keycap'), function(cap){
    cap.addEventListener('click', function(){ routeTourKey(cap.textContent.trim().toLowerCase()); });
  });
  overlayEl.querySelector('#tourCourt').style.display = step.hideCourt ? 'none' : '';
  var dotsEl = overlayEl.querySelector('#tourDots');
  dotsEl.innerHTML = steps.map(function(_,i){
    return '<span class="tourDot'+(i===cursor?' on':'')+'"></span>';
  }).join('');
  var backBtn = overlayEl.querySelector('#tourBack');
  backBtn.disabled = cursor===0;
  var nextBtn = overlayEl.querySelector('#tourNext');
  nextBtn.textContent = cursor===steps.length-1 ? 'Start tagging' : 'Next';
  // "do it" steps (expect != null) advance only via the action itself — Next is greyed out so
  // the user isn't tempted to click it.
  nextBtn.disabled = !!step.expect;
  nextBtn.classList.toggle('gho', !!step.expect);
  nextBtn.classList.toggle('pri', !step.expect);
  if(typeof step.onEnter === 'function') step.onEnter(step);
}

// ---------- keyboard isolation ----------
function installKeyIsolation(){
  keyHandler = function(e){
    e.stopPropagation();
    if(e.key === 'Escape'){ e.preventDefault(); closeTour(); return; }
    routeTourKey((e.key||'').toLowerCase());
  };
  document.addEventListener('keydown', keyHandler, true);
}
function teardownKeyIsolation(){
  if(keyHandler){ document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
}

// ---------- demo court (Task B) ----------
// Same geometry as js/court.js's live court (viewBox 0 0 300 360, 2x2 zone grid split at the
// short line) but built standalone — the tour never imports court.js and never touches S.M.
var COLX=[6,150], ROWY=[6,186], CW=144, ROWH=[180,168];
function buildDemoCourt(){
  var container = document.getElementById('tourCourt');
  if(!container) return;
  var ns = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 300 360');
  svg.setAttribute('class','court');
  svg.setAttribute('aria-label','demo squash court, tap a zone');

  var floor = document.createElementNS(ns,'rect');
  floor.setAttribute('x','6'); floor.setAttribute('y','6'); floor.setAttribute('width','288'); floor.setAttribute('height','348');
  floor.setAttribute('rx','4'); floor.setAttribute('fill','var(--maple)');
  svg.appendChild(floor);

  var shortLine = document.createElementNS(ns,'line');
  shortLine.setAttribute('x1','6'); shortLine.setAttribute('y1','186'); shortLine.setAttribute('x2','294'); shortLine.setAttribute('y2','186');
  shortLine.setAttribute('stroke','var(--maple-line)'); shortLine.setAttribute('stroke-width','2.5');
  svg.appendChild(shortLine);

  var halfLine = document.createElementNS(ns,'line');
  halfLine.setAttribute('x1','150'); halfLine.setAttribute('y1','186'); halfLine.setAttribute('x2','150'); halfLine.setAttribute('y2','354');
  halfLine.setAttribute('stroke','var(--maple-line)'); halfLine.setAttribute('stroke-width','2.5');
  svg.appendChild(halfLine);

  [[6,186],[220,186]].forEach(function(xy){
    var box = document.createElementNS(ns,'rect');
    box.setAttribute('x',xy[0]); box.setAttribute('y',xy[1]); box.setAttribute('width','74'); box.setAttribute('height','74');
    box.setAttribute('fill','none'); box.setAttribute('stroke','var(--maple-line)'); box.setAttribute('stroke-width','2.5');
    svg.appendChild(box);
  });

  var zoneG = document.createElementNS(ns,'g');
  var rows=['F','B'], cols=['L','R'];
  zoneFillEls = {};
  rows.forEach(function(rw,ri){ cols.forEach(function(cl,ci){
    var z = rw+cl, x=COLX[ci], y=ROWY[ri], ch=ROWH[ri];
    var fill = document.createElementNS(ns,'rect');
    fill.setAttribute('x',x+1.5); fill.setAttribute('y',y+1.5); fill.setAttribute('width',CW-3); fill.setAttribute('height',ch-3);
    fill.setAttribute('rx','3'); fill.setAttribute('class','zcell'); fill.setAttribute('fill','transparent');
    zoneG.appendChild(fill);
    zoneFillEls[z] = fill;

    var lab = document.createElementNS(ns,'text');
    lab.setAttribute('x',x+CW/2); lab.setAttribute('y',y+ch/2+4); lab.setAttribute('text-anchor','middle'); lab.setAttribute('class','zlab');
    lab.textContent = z;
    zoneG.appendChild(lab);

    var hit = document.createElementNS(ns,'rect');
    hit.setAttribute('x',x); hit.setAttribute('y',y); hit.setAttribute('width',CW); hit.setAttribute('height',ch);
    hit.setAttribute('class','zone'); hit.setAttribute('data-z',z);
    hit.addEventListener('click', function(){ handleDemoZoneTap(z); });
    zoneG.appendChild(hit);
  }); });
  svg.appendChild(zoneG);

  container.innerHTML = '';
  container.appendChild(svg);
}

// handleDemoZoneTap: the demo court's only click handler. Routes through tourZoneTap() (never
// touches S.M) and flashes ok/bad feedback on the tapped cell, then clears the flash so it can
// re-fire on a later tap of the same zone.
function handleDemoZoneTap(z){
  var ok = tourZoneTap(z);
  var fill = zoneFillEls[z];
  if(!fill) return;
  var cls = ok ? 'tour-flash-ok' : 'tour-flash-bad';
  fill.classList.remove('tour-flash-ok','tour-flash-bad');
  void fill.offsetWidth; // force reflow so the animation restarts if it was just applied
  fill.classList.add(cls);
  setTimeout(function(){ fill.classList.remove(cls); }, 550);
}

// ---------- pulse guidance ----------
// currentExpectZones: the zone(s) the current step is waiting on right now (accounting for
// seqProgress on {type:'seq'} steps) — [] for key-only or info steps.
function currentExpectZones(){
  var step = steps[cursor];
  if(!step || !step.expect) return [];
  var exp = step.expect;
  if(exp.type==='zone') return exp.zones;
  if(exp.type==='seq'){
    var item = exp.items[seqProgress];
    return (item && item.type==='zone') ? item.zones : [];
  }
  return [];
}
function updateCourtPulse(){
  ZONE_LIST.forEach(function(z){
    var el = zoneFillEls[z];
    if(el) el.classList.remove('tour-pulse');
  });
  currentExpectZones().forEach(function(z){
    var el = zoneFillEls[z];
    if(el) el.classList.add('tour-pulse');
  });
  updateHand();
}

// ---------- hand guidance ----------
// A floating 👆 that taps on whatever the current step is waiting on: the pulsed court zone(s)
// (centroid, so a whole-column serve target reads as one spot), the first keycap in the
// instruction body on key phases, or the Next button on info steps. The overlay is fixed at
// inset:0, so client coords map straight onto it; measured inside rAF so layout has settled.
function updateHand(){
  if(!overlayEl) return;
  requestAnimationFrame(function(){
    if(!overlayEl) return;
    var hand = overlayEl.querySelector('#tourHand');
    if(!hand) return;
    var pt = handTargetPoint();
    if(!pt){ hand.style.display='none'; return; }
    hand.style.display='block';
    hand.style.left = pt.x+'px';
    hand.style.top = pt.y+'px';
  });
}
function handTargetPoint(){
  var zones = currentExpectZones();
  if(zones.length){
    var cx=0, cy=0, n=0;
    zones.forEach(function(z){
      var el = zoneFillEls[z]; if(!el) return;
      var r = el.getBoundingClientRect();
      cx += r.left+r.width/2; cy += r.top+r.height/2; n++;
    });
    if(n) return {x:cx/n, y:cy/n};
  }
  var step = steps[cursor], exp = step && step.expect;
  var item = exp && exp.type==='seq' ? exp.items[seqProgress] : exp;
  if(item && item.type==='key'){
    var cap = overlayEl.querySelector('#tourStepBody .keycap');
    if(cap){ var rk = cap.getBoundingClientRect(); return {x:rk.left+rk.width/2, y:rk.bottom-2}; }
  }
  if(!exp){
    var nx = overlayEl.querySelector('#tourNext');
    if(nx){ var rn = nx.getBoundingClientRect(); return {x:rn.left+rn.width/2, y:rn.top+rn.height/2}; }
  }
  return null;
}

// onStepEnter: the onEnter hook shared by every step — refreshes the court pulse and the video
// pane for whatever step just became current.
function onStepEnter(step){
  updateCourtPulse();
  updateVideoPane(step);
}

// ---------- video pane: segment engine ----------
// The tour scripts play/stop against the clip: each interactive phase has a {from,to} segment,
// played via loadVideoById({startSeconds, endSeconds}) so the player itself stops at `to`; a
// cosmetic poll pauses a beat earlier to avoid the ENDED end screen. The player is created once,
// reused across steps at 1×, and destroyed on closeTour(). Entirely independent of
// js/youtube.js's module-private player.

// stepUsesVideo: does this step drive the clip at any phase?
function stepUsesVideo(step){
  if(step.video) return true;
  var exp = step.expect;
  if(exp && exp.type==='seq'){
    return exp.items.some(function(it){ return !!it.video; });
  }
  return false;
}

// currentSegment: the {from,to} segment for the phase the step is waiting on right now, or null
// (null on info steps, and on phases that just hold the last pause frame — e.g. the landing tap).
function currentSegment(step){
  var exp = step.expect;
  if(exp && exp.type==='seq'){
    var it = exp.items[seqProgress];
    return (it && it.video) || null;
  }
  return step.video || null;
}

// markReady: single entry point for "the player can take commands now" — reached from onReady
// or from the watcher below, whichever happens first.
function markReady(){
  if(playerReady) return;
  playerReady = true;
  if(readyWatch){ clearInterval(readyWatch); readyWatch = null; }
  if(pendingSeg){ var s = pendingSeg; pendingSeg = null; playSegment(s); }
}
// ensureReadyWatch: onReady sometimes never fires for dynamically-created players; the API
// attaches the command methods to the player object once the handshake completes, so poll for
// them and declare readiness ourselves.
function ensureReadyWatch(){
  if(readyWatch || playerReady) return;
  readyWatch = setInterval(function(){
    if(tourPlayer && typeof tourPlayer.loadVideoById==='function' && typeof tourPlayer.getCurrentTime==='function'){
      markReady();
    }
  }, 150);
}

function playSegment(seg){
  if(!tourPlayer || !playerReady){
    pendingSeg = seg;
    ensureReadyWatch();
    return;
  }
  pendingSeg = null;
  stopSegmentPoll();
  activeSeg = seg;
  holding = false;
  // loadVideoById with {startSeconds, endSeconds} is the documented auto-stop: it loads, plays,
  // and the player itself stops at endSeconds (broadcasting ENDED). endSeconds has a history of
  // being flaky, so the poll below is the primary stop and endSeconds the backstop. Never call
  // seekTo() while a segment is armed — per the docs it invalidates endSeconds, and from any
  // non-paused state it also *starts playback*.
  try{
    tourPlayer.loadVideoById({ videoId:TOUR_CLIP.videoId, startSeconds:seg.from, endSeconds:seg.to });
    tourPlayer.setPlaybackRate(seg.rate||1); // rate<1 stretches the wall-clock time of the segment
  }catch(_){ return; }
  killCaptions(tourPlayer);
  pollTimer = setInterval(function(){
    var t = 0;
    try{ t = tourPlayer.getCurrentTime(); }catch(_){ return; } // skip the tick, keep the poll alive
    if(t >= seg.to - 0.1){
      stopSegmentPoll();
      holding = true;
      try{ tourPlayer.pauseVideo(); }catch(_){}
    }
  }, 40);
}
function stopSegmentPoll(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
}

// killCaptions(p): force captions off. cc_load_policy only force-enables, so there's no playerVar
// to turn them off; the caption module also reloads each time a new video loads. So we clear the
// active track and unload the module — and this runs again on every PLAYING (see onStateChange),
// since by then the freshly loaded module exists. Names differ across builds; failures are ignored.
function killCaptions(p){
  if(!p) return;
  try{ p.setOption('captions', 'track', {}); }catch(_){}
  try{ p.setOption('cc', 'track', {}); }catch(_){}
  try{ p.unloadModule('captions'); }catch(_){}
  try{ p.unloadModule('cc'); }catch(_){}
}

function updateVideoPane(step){
  var mediaEl = overlayEl && overlayEl.querySelector('#tourMedia');
  if(!mediaEl) return;
  var placeholder = mediaEl.querySelector('.tourMediaPlaceholder');
  if(!TOUR_CLIP.videoId || !window.YT || !window.YT.Player){
    // no clip configured or iframe API unavailable — placeholder, no errors
    if(placeholder) placeholder.style.display = '';
    return;
  }
  if(placeholder) placeholder.style.display = 'none'; // clip configured — pane stays blank until a segment plays
  if(!tourPlayer){
    // no embed until a step actually plays a clip — on the welcome step there'd be nothing but a
    // clickable cued player, which invites a stray "play" outside the scripted segments
    if(!stepUsesVideo(step)) return;
    var div = document.createElement('div');
    div.id = 'tourPlayerDiv';
    mediaEl.appendChild(div);
    tourPlayer = new YT.Player(div, {
      videoId: TOUR_CLIP.videoId,
      width:'100%', height:'100%',
      playerVars:{ start:TOUR_CLIP.start, controls:0, rel:0, modestbranding:1, playsinline:1, mute:1, disablekb:1, cc_load_policy:0, iv_load_policy:3,
        // explicit origin: without it the api's postMessage handshake mis-targets on plain-http
        // pages (localhost) and stalls/retries with DOMWindow origin warnings
        origin:window.location.origin },
      events:{
        'onReady':function(e){
          try{ e.target.mute(); }catch(_){}
          markReady('onReady');
        },
        'onStateChange':function(e){
          if(!window.YT) return;
          // endSeconds backstop: the segment ran to its armed end before the poll paused it.
          // pauseVideo from ENDED is a documented no-op, so seek back inside the segment —
          // which exits ENDED but also starts playback; the holding rule below re-pauses it.
          if(e.data===YT.PlayerState.ENDED && activeSeg){
            holding = true;
            try{ e.target.seekTo(activeSeg.to, true); }catch(_){}
            return;
          }
          // captions reload with each new video; the module is only live once playback starts,
          // so re-kill it here (not just at load time in playSegment).
          if(e.data===YT.PlayerState.PLAYING) killCaptions(e.target);
          // holding rule: while parked, any PLAYING that sneaks through (a seek finishing after
          // pauseVideo, an end-screen restart) is paused again — pause always wins.
          if(e.data===YT.PlayerState.PLAYING && holding){
            try{ e.target.pauseVideo(); }catch(_){}
          }
        },
        'onError':function(e){
          // surface embed failures (embedding disabled, region block …) instead of a dead pane
          var ph = overlayEl && overlayEl.querySelector('.tourMediaPlaceholder');
          if(ph){ ph.textContent = 'clip unavailable (YouTube error '+e.data+')'; ph.style.display=''; }
        }
      }
    });
    // player still initializing; the current phase's segment starts once markReady fires
    var firstSeg = currentSegment(step);
    if(firstSeg) pendingSeg = firstSeg;
    ensureReadyWatch();
    return;
  }
  var seg = currentSegment(step);
  if(seg){
    playSegment(seg);
  } else if(!stepUsesVideo(step)){
    // steps with no clip involvement park the video on its last pause frame
    pendingSeg = null;
    stopSegmentPoll();
    holding = true;
    try{ tourPlayer.pauseVideo(); }catch(_){}
  }
  // else: a mid-step phase with no segment of its own (e.g. the landing tap after `w`) — leave
  // the running segment to finish to its pause mark
}
