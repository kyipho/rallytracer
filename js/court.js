// ---------- court rendering ----------
import { S, requestRender, clearRedo, focusRally, curGame, rallyOpen, strikerFor } from './state.js';
import { ZROWS, ZCOLS, newGame, newRally, direction } from './model.js';
import { playZoneBlip, playRejectBlip } from './audio.js';
import { toast } from './toast.js';
import { tagTime, getPlayer } from './youtube.js';

// 2x2 grid: cols L/R (144 wide each), rows F/B split at the short line (y=186) — front is taller
// (180) than back (168) because the short line sits 186 down a 6-354 (348-tall) floor.
export var COLX=[6,150], ROWY=[6,186], CW=144, ROWH=[180,168];
(function buildZones(){
  var g=document.getElementById('zoneG'), ns='http://www.w3.org/2000/svg';
  ZROWS.forEach(function(rw,ri){ ZCOLS.forEach(function(cl,ci){
    var z=rw+cl, x=COLX[ci], y=ROWY[ri], ch=ROWH[ri];
    var fill=document.createElementNS(ns,'rect');
    fill.setAttribute('x',x+1.5); fill.setAttribute('y',y+1.5); fill.setAttribute('width',CW-3); fill.setAttribute('height',ch-3);
    fill.setAttribute('rx',3); fill.setAttribute('class','zcell'); fill.setAttribute('id','fill-'+z); fill.setAttribute('fill','transparent');
    g.appendChild(fill);
    var lab=document.createElementNS(ns,'text');
    lab.setAttribute('x',x+CW/2); lab.setAttribute('y',y+ch/2+4); lab.setAttribute('text-anchor','middle'); lab.setAttribute('class','zlab');
    lab.textContent=z; g.appendChild(lab);
    var hit=document.createElementNS(ns,'rect');
    hit.setAttribute('x',x); hit.setAttribute('y',y); hit.setAttribute('width',CW); hit.setAttribute('height',ch);
    hit.setAttribute('class','zone'); hit.setAttribute('data-z',z);
    hit.addEventListener('click',function(){ onZone(z); });
    // while a serve tap is expected, hovering either half previews that side's service box
    hit.addEventListener('mouseenter',function(){
      var tm=tapMode();
      if(tm.mode==='serve'||tm.mode==='newrally'||tm.mode==='newgame') previewServeSide(cl);
    });
    hit.addEventListener('mouseleave',function(){
      var tm=tapMode();
      if(tm.mode==='serve'||tm.mode==='newrally'||tm.mode==='newgame') paintZones();
    });
    g.appendChild(hit);
  });});
})();
function previewServeSide(col){
  // highlight both zone cells of the serving side (not just the service box) so the preview
  // matches what paintZones() shows once the serve is actually pending
  var ids = col==='L' ? ['fill-FL','fill-BL'] : ['fill-FR','fill-BR'];
  ids.forEach(function(id){
    var el=document.getElementById(id);
    el.setAttribute('fill','rgba(242,169,59,.16)'); el.setAttribute('stroke','var(--amber)'); el.setAttribute('stroke-width','1');
  });
}
// activeShot = the shot the editor panel's stroke/contact/zones rows operate on in EDIT mode
// (see currentEditShot/isOutcomeEditable). The end-rally outcome/flip controls do NOT go through
// this — in LIVE mode they act directly on focusRally()'s own last shot (see renderEditor/setOutcome).
// While a rally is open, the LAST shot is always the pending one (no target yet),
// so the editable shot is the one before it — the last fully resolved shot.
// Once the rally is closed, the last shot IS the ender (editable directly, even
// mid-landing-tap, since outcome/contact don't depend on target).
function activeShot(){
  var r=focusRally(); if(!r) return null;
  if(rallyOpen(r)){
    return r.shots.length>=2 ? r.shots[r.shots.length-2] : null;
  }
  return r.shots.length ? r.shots[r.shots.length-1] : null;
}
// tapMode = what a court tap means right now (drives hint text + highlighting)
export function tapMode(){
  if(S.awaitingTarget) return {mode:'landing'};
  if(S.armZone) return {mode:'arm'};
  var g=curGame(), r=focusRally();
  if(g.done) return {mode:'newgame'};
  if(!rallyOpen(r)) return {mode:'newrally', server:S.M.server};
  if(r.shots.length===0) return {mode:'serve', server:r.server};
  return {mode:'strike', striker:strikerFor(r,r.shots.length)};
}

// ---------- which shot the editor panel is bound to ----------
// A clicked tape row (selectedShot) takes priority; otherwise fall back to the live active shot.
export function currentEditShot(){
  if(S.selectedShot && S.selectedShot.shot) return S.selectedShot.shot;
  return activeShot();
}
// Outcome/stroke-flip controls only ever touch the LIVE rally's own last shot (terminal or
// pending) — editing history is limited to stroke/contact/zone touch-ups, never score-affecting,
// so a past rally's recorded point can never accidentally drift out of sync with later rallies/games.
export function isOutcomeEditable(sh){
  if(!sh) return false;
  var r=focusRally();
  return r.shots.indexOf(sh)===r.shots.length-1;
}

function clearBoxFill(){
  ['boxL-fill','boxR-fill'].forEach(function(id){
    var el=document.getElementById(id); el.setAttribute('fill','transparent'); el.removeAttribute('stroke'); el.removeAttribute('stroke-width');
  });
}
export function paintZones(){
  ZROWS.forEach(function(rw){ ZCOLS.forEach(function(cl){
    var el=document.getElementById('fill-'+rw+cl); el.setAttribute('class','zcell'); el.setAttribute('fill','transparent'); el.removeAttribute('stroke'); el.removeAttribute('stroke-width');
  });});
  clearBoxFill();
  var r=focusRally(); if(!r || !r.shots.length) return;
  // anchor = where the ball currently is, i.e. the last tapped position
  var last=r.shots[r.shots.length-1];
  var anchor = rallyOpen(r) ? last.start : (S.awaitingTarget ? last.start : null);
  if(!anchor) return;
  if(last.idx===0 && last.end==null){
    // pending serve: highlight BOTH zone cells of the serving side (whole column), not just the
    // service box — tap still records BL/BR by column regardless of what's painted here
    var col=anchor[1];
    ['F'+col,'B'+col].forEach(function(z){
      var el=document.getElementById('fill-'+z);
      el.setAttribute('fill', S.awaitingTarget?'rgba(230,51,41,.22)':'rgba(242,169,59,.28)');
      el.setAttribute('stroke', S.awaitingTarget?'var(--red)':'var(--amber)');
      el.setAttribute('stroke-width','1.5');
    });
    return;
  }
  var s=document.getElementById('fill-'+anchor);
  s.setAttribute('fill', S.awaitingTarget?'rgba(230,51,41,.22)':'rgba(242,169,59,.28)');
  s.setAttribute('stroke', S.awaitingTarget?'var(--red)':'var(--amber)');
  s.setAttribute('stroke-width','1.5');
}

// ---------- core: tap a zone ----------
function onZone(z){
  clearRedo();
  // 1) landing tap for a winner/error that's still awaiting its target
  if(S.awaitingTarget){
    playZoneBlip(z);
    var r0=focusRally(); var sh0=r0.shots[r0.shots.length-1];
    sh0.end=z;
    var sv0=sh0.idx===0;
    sh0.direction=sv0?null:direction(sh0.start,z);
    S.awaitingTarget=false;
    // landing is complete — auto-resume playback (a property of finishing this step, regardless
    // of whether the tap came from the mouse or the keyboard)
    var pl0=getPlayer();
    if(S.autoResume && pl0 && pl0.playVideo){ try{ pl0.playVideo(); }catch(_){} }
    requestRender(); return;
  }
  // 2) editing start/end of the shot bound to the editor panel (preserves selection — this
  //    tap is a touch-up, not a live advance, so it should not bump you out of "editing history")
  if(S.armZone){
    playZoneBlip(z);
    var sh=currentEditShot();
    if(sh){
      if(S.armZone==='end' && sh.end!=null) sh.end=z; else sh.start=z;
      var sv=sh.idx===0;
      if(sh.end!=null){
        sh.direction=sv?null:direction(sh.start,sh.end);
      }
    }
    S.armZone=null; requestRender(); return;
  }
  // a genuine new strike/serve is blocked once the match is over (editing/undo still work)
  if(S.M.matchOver){ playRejectBlip(); toast('Match over — reset or start a new match'); return; }
  // any tap from here on is a genuine live advance — resume live tagging
  playZoneBlip(z); // registration confirmation — only accepted taps blip, mouse or keyboard
  S.selectedShot=null;
  // 3) lazily start a new game / rally if the focused one is finished
  var g=curGame(), r=focusRally();
  if(g.done){ g=newGame(g.no+1,S.M.server); S.M.games.push(g); r=focusRally(); }
  else if(!rallyOpen(r)){ g.rallies.push(newRally(r.no+1, S.M.server)); r=focusRally(); }
  // 4) first tap of the rally: the serve's strike position. A serve tap on ANY zone registers as
  //    struck from that side's service box — col L -> BL, col R -> BR (there's no front/back
  //    distinction for a serve, only which side of the court it's struck from).
  if(r.shots.length===0){
    var serveSide = z[1]==='L' ? 'BL' : 'BR';
    r.shots.push({ idx:0, striker:r.server, stroke:'serve',
      direction:null, contact:'ground', start:serveSide, end:null, outcome:'in_play', t:tagTime() });
    S.actionStack.push('shot');
    requestRender(); return;
  }
  // 5) a regular strike: finalise the previous (pending) shot's end, then open a new pending shot.
  //    The new shot's start IS this tap, so this tap's video time is the new shot's timestamp.
  var prev=r.shots[r.shots.length-1];
  var prevServe=prev.idx===0;
  prev.end=z;
  prev.direction=prevServe?null:direction(prev.start,z);
  var idx=r.shots.length;
  r.shots.push({ idx:idx, striker:strikerFor(r,idx), stroke:null,
    direction:null, contact:'ground', start:z, end:null, outcome:'in_play', t:tagTime() });
  S.actionStack.push('shot');
  requestRender();
}
