// ---------- undo / redo ----------
// undo dispatches on the actionStack top: a manual event record is reversed by restoring its
// snapshot; otherwise the live shot-undo runs. The shot-undo's internal recursion (dropping empty
// rallies/games) is kept OUT of the marker accounting — exactly one 'shot' marker is consumed per
// user-perceived undo, regardless of how many internal recursion steps it takes.
import { S, requestRender, curGame, focusRally, rallyOpen } from './state.js';
import { restoreSnapshot, recomputeMatchOver } from './outcomes.js';
import { revertRallyClose, reopenAsPending } from './awards.js';
import { toast } from './toast.js';

export function undo(){
  S.selectedShot=null;
  var top=S.actionStack.length ? S.actionStack[S.actionStack.length-1] : null;
  if(top && typeof top==='object'){
    S.redoStack.push({mSnap:JSON.stringify(S.M), aSnap:JSON.stringify(S.actionStack)});
    // reverse a manual award/reset action
    restoreSnapshot(top.snap);
    if(top.rallies){ curGame().rallies=JSON.parse(JSON.stringify(top.rallies)); }
    if(top.eventsSnap){ S.M.events=JSON.parse(JSON.stringify(top.eventsSnap)); }
    else {
      // find by id so this works even after redo restores M from JSON (new object instances)
      var eid=top.event.id, evs=S.M.events||[], ix=-1;
      for(var i=0;i<evs.length;i++){ if(evs[i].id===eid){ ix=i; break; } }
      if(ix>=0) S.M.events.splice(ix,1);
    }
    S.actionStack.pop();
    S.awaitingTarget=false; S.viewGameIdx=null; S.expandedRally=null;
    recomputeMatchOver();
    requestRender(); return;
  }
  var snap={mSnap:JSON.stringify(S.M), aSnap:JSON.stringify(S.actionStack)};
  var did=shotUndo();
  if(did){
    S.redoStack.push(snap);
    if(S.actionStack.length && S.actionStack[S.actionStack.length-1]==='shot') S.actionStack.pop();
  }
}
// shotUndo performs ONE user-perceived live-tagging undo (internally recursing past empty rallies).
// Returns true if it changed anything (so the caller knows to consume a marker).
export function shotUndo(){
  // cancel an outcome click that's still waiting on its landing tap
  if(S.awaitingTarget){
    var r1=focusRally(); var sh1=r1.shots[r1.shots.length-1];
    revertRallyClose(r1); reopenAsPending(sh1);
    S.awaitingTarget=false; requestRender(); return true;
  }
  var g=curGame(); var r=focusRally();
  if(!r){ toast('Nothing to undo'); return false; }
  if(rallyOpen(r)){
    if(r.shots.length>=2){
      r.shots.pop();                              // drop the pending shot just opened
      reopenAsPending(r.shots[r.shots.length-1]);  // the shot it finalised goes back to pending
      requestRender(); return true;
    }
    if(r.shots.length===1){ r.shots.pop(); requestRender(); return true; }
    // empty open rally (nothing tapped yet): drop it and recurse onto the previous one. This
    // recursion is internal cleanup — it must NOT consume an extra marker, so it calls shotUndo.
    if(g.rallies.length>1){ g.rallies.pop(); return shotUndo(); }
    if(S.M.games.length>1){ S.M.games.pop(); return shotUndo(); }
    toast('Nothing to undo'); return false;
  }
  // rally fully closed -> reopen it, reverting score/game and the ender back to pending
  revertRallyClose(r);
  reopenAsPending(r.shots[r.shots.length-1]);
  requestRender(); return true;
}

export function restoreFullM(mSnap){
  var obj=JSON.parse(mSnap), k;
  for(k in S.M){ if(Object.prototype.hasOwnProperty.call(S.M,k)) delete S.M[k]; }
  for(k in obj){ if(Object.prototype.hasOwnProperty.call(obj,k)) S.M[k]=obj[k]; }
}
export function redo(){
  if(!S.redoStack.length){ toast('Nothing to redo'); return; }
  var entry=S.redoStack.pop();
  restoreFullM(entry.mSnap);
  S.actionStack=JSON.parse(entry.aSnap);
  S.selectedShot=null; S.awaitingTarget=false; S.viewGameIdx=null; S.expandedRally=null;
  recomputeMatchOver();
  requestRender();
}
