// ---------- insert / delete shot rows ----------
// these mutate the shot array directly. Striker always re-derives (positional alternation), since
// removing/adding a shot necessarily reflips who-hit-what for everything after it in the rally.
// Start/end zones are NEVER auto-stitched across the edit — if that leaves a shot's end disagreeing
// with the next shot's start, the inconsistency flag (a small red !) surfaces it instead of hiding it.
import { S, requestRender, clearRedo, focusRally, curGame, rallyOpen, strikerFor } from './state.js';
import { direction } from './model.js';
import { scoreSnapshot } from './outcomes.js';
import { revertRallyClose, reopenAsPending, logEvent } from './awards.js';
import { isOutcomeEditable } from './court.js';
import { toast } from './toast.js';

export function selectedRally(){
  if(!S.selectedShot) return null;
  var g=S.M.games[S.selectedShot.gameNo-1];
  return g && g.rallies[S.selectedShot.rallyNo-1];
}
export function renumberAndRederive(r){
  r.shots.forEach(function(sh,i){
    sh.idx=i;
    sh.striker=strikerFor(r,i);
    if(i===0){
      sh.stroke='serve'; sh.direction=null;
    } else if(sh.stroke==='serve'){
      // this shot used to occupy idx 0 but no longer does — 'serve' isn't a valid label anywhere
      // else, so clear it. This corrects an invalid label, it does not guess at a replacement.
      sh.stroke=null;
      sh.direction=sh.end!=null?direction(sh.start,sh.end):null;
    }
  });
}
export function chainBroken(r,i){
  var sh=r.shots[i], nxt=r.shots[i+1];
  if(!nxt || sh.end==null || nxt.start==null) return false; // nothing to compare, or still unresolved
  return sh.end!==nxt.start;
}
export function deleteShot(){
  var r=selectedRally(); if(!r) return;
  var idx=S.selectedShot.idx, sh=r.shots[idx];
  if(!sh) return;
  var isTerminal = idx===r.shots.length-1;
  if(isTerminal && rallyOpen(r)){
    toast('Use Undo to remove the in-progress shot'); return;
  }
  if(isTerminal && !rallyOpen(r)){
    // removing the shot that holds the rally's outcome — only allowed for the live rally, same
    // restriction as outcome editing, so a historical score can never silently drift
    if(!isOutcomeEditable(sh)){ toast("Can't delete a past rally's result — only stroke/zone edits are allowed there"); return; }
    revertRallyClose(r);
  }
  clearRedo();
  r.shots.splice(idx,1);
  renumberAndRederive(r);
  if(r.shots.length===0 && r!==focusRally()){
    // an emptied HISTORICAL rally is removed outright rather than left as an orphan
    var g=S.M.games[S.selectedShot.gameNo-1];
    var ri=g.rallies.indexOf(r); if(ri>=0) g.rallies.splice(ri,1);
  }
  S.selectedShot=null;
  requestRender(); toast('Shot deleted');
}
// overwriteFromShot wipes the selected shot AND everything after it in its rally, then reopens the
// rally for live re-tagging from that shot's strike position. Only valid on the LIVE rally (live
// tagging always appends to focusRally, so truncating any other rally couldn't be re-tagged).
export function overwriteFromShot(){
  if(!S.selectedShot) return;
  var r=selectedRally();
  if(!r || S.selectedShot.gameNo!==S.M.games.length || r!==focusRally()){
    toast('Re-tag from here works on the current rally only'); return;
  }
  var idx=S.selectedShot.idx;
  if(!confirm('Re-tag from shot '+(idx+1)+' onward? This shot and everything after it in the rally are cleared.')) return;
  clearRedo();
  var snap=scoreSnapshot();
  var rallies=JSON.parse(JSON.stringify(curGame().rallies));
  var eventsSnap=JSON.parse(JSON.stringify(S.M.events||[]));
  if(!rallyOpen(r)) revertRallyClose(r);
  r.shots=r.shots.slice(0,idx);
  if(r.shots.length>0){ reopenAsPending(r.shots[r.shots.length-1]); }
  else { r.outcome=null; r.pointWinner=null; }
  renumberAndRederive(r);
  S.selectedShot=null; S.awaitingTarget=false; S.armZone=null; S.expandedRally=null;
  var ev=logEvent('overwrite_from',null,'R'+r.no+' shot '+(idx+1)+' onward');
  S.actionStack.push({event:ev, snap:snap, rallies:rallies, eventsSnap:eventsSnap});
  requestRender(); toast('Cleared from shot '+(idx+1)+' — re-tap to continue');
}
export function insertShot(position){
  var r=selectedRally(); if(!r) return;
  if(rallyOpen(r)){
    toast('Finish or end this rally before inserting — keeps the in-progress shot unambiguous'); return;
  }
  var idx=S.selectedShot.idx;
  if(position==='after' && idx===r.shots.length-1){
    toast("Can't insert after the rally's result"); return;
  }
  clearRedo();
  var insertAt = position==='before' ? idx : idx+1;
  var prevShot = r.shots[insertAt-1];
  var suggestedStart = prevShot ? prevShot.end : null;  // auto-suggest: previous shot's end -> this shot's start
  var newShot = { idx:0, striker:null, stroke:null,
    direction:null, contact:'ground', start:suggestedStart, end:null, outcome:'in_play', t:null };
  r.shots.splice(insertAt,0,newShot);
  renumberAndRederive(r);
  S.selectedShot = {shot:newShot, gameNo:S.selectedShot.gameNo, rallyNo:S.selectedShot.rallyNo, idx:insertAt};
  requestRender(); toast('Shot inserted — set its end zone');
}
