// ---------- outcomes ----------
import { S, requestRender, clearRedo, focusRally, curGame, rallyOpen } from './state.js';
import { other } from './model.js';
import { playOutcomeBlip } from './audio.js';
import { toast } from './toast.js';

export function setOutcome(o, strokeWinner){
  var r=focusRally(); if(!r) return;
  clearRedo();
  var g=curGame();
  var wasOpen=rallyOpen(r);
  // if this rally was already closed (re-picking a different outcome), revert its effect first
  if(!wasOpen){
    if(g.done){ S.M.gamesWon[g.winner]-=1; g.done=false; g.winner=null; }
    if(r.pointWinner){ g[r.pointWinner]-=1; }
    S.M.server=r.server; S.awaitingTarget=false;
    recomputeMatchOver();
  }
  var sh=r.shots[r.shots.length-1];
  if(!sh){ toast('Tap a strike first'); return; }
  playOutcomeBlip();
  sh.outcome=o;
  if(o==='stroke' || o==='let' || o==='no_let'){ sh.end=null; sh.stroke=null; sh.direction=null; }
  var pw=null;
  if(o==='winner') pw=sh.striker;
  else if(o==='stroke') pw = strokeWinner ? strokeWinner : sh.striker;
  else if(o==='unforced_error'||o==='forced_error') pw=other(sh.striker);
  else if(o==='no_let') pw = other(strokeWinner || sh.striker);
  r.outcome=o; r.pointWinner=pw;
  if(o!=='let' && pw){
    g[pw]+=1;
    S.M.server=pw;                      // PAR: point winner serves next
    checkGame(g);
  } else if(o==='let'){
    S.M.server=r.server;                // replay: same server, no score
  }
  // winner/error still need a landing tap to capture where the ball went
  S.awaitingTarget = (o==='winner'||o==='unforced_error'||o==='forced_error') && sh.end==null;
  // Push a shot-undo marker only for the FIRST close of an open rally — that adds one peelable
  // step (revertRallyClose) the existing undo can reverse. A re-pick on an already-closed rally
  // modifies it in place (no new layer), so it stays covered by the original close's marker.
  if(wasOpen) S.actionStack.push('shot');
  requestRender();
}
export function checkGame(g){
  if((g.A>=11||g.B>=11) && Math.abs(g.A-g.B)>=2){
    g.done=true; g.winner=g.A>g.B?'A':'B'; S.M.gamesWon[g.winner]+=1;
    S.M.server=g.winner;                 // winner of game serves first next game
    toast('Game '+g.no+' to '+(g.winner==='A'?S.M.playerA:S.M.playerB));
  }
  recomputeMatchOver();
}
// recomputeMatchOver derives matchOver/matchWinner from gamesWon (best-of) plus the manual
// forcedOver flag. Idempotent and called after EVERY gamesWon change (including every revert), so
// the match-over state can never drift out of sync with the game count.
export function recomputeMatchOver(){
  var needed=Math.ceil((S.M.bestOf||5)/2);
  var auto = S.M.gamesWon.A>=needed || S.M.gamesWon.B>=needed;
  S.M.matchWinner = S.M.gamesWon.A>=needed ? 'A' : (S.M.gamesWon.B>=needed ? 'B' : (S.M.forcedOver ? S.M.matchWinner : null));
  S.M.matchOver = auto || S.M.forcedOver;
}
// scoreSnapshot captures everything a manual (award/reset) action might mutate, so undo can
// restore it exactly rather than trying to invert each action arithmetically.
export function scoreSnapshot(){
  var g=curGame();
  return { gamesLen:S.M.games.length, A:g.A, B:g.B, gameDone:g.done, gameWinner:g.winner, server:S.M.server,
           gamesWonA:S.M.gamesWon.A, gamesWonB:S.M.gamesWon.B,
           matchOver:S.M.matchOver, forcedOver:S.M.forcedOver, matchWinner:S.M.matchWinner };
}
export function restoreSnapshot(snap){
  // a manual action's snapshot belongs to whatever was the current game then; if a later game was
  // started afterwards its shot-markers sit ABOVE this record and are peeled first, so by the time
  // we get here those trailing games are empty and safe to drop back to the snapshot's game count.
  while(S.M.games.length>snap.gamesLen) S.M.games.pop();
  var g=curGame();
  g.A=snap.A; g.B=snap.B; g.done=snap.gameDone; g.winner=snap.gameWinner;
  S.M.server=snap.server; S.M.gamesWon.A=snap.gamesWonA; S.M.gamesWon.B=snap.gamesWonB;
  S.M.matchOver=snap.matchOver; S.M.forcedOver=snap.forcedOver; S.M.matchWinner=snap.matchWinner;
}
export function flipPoint(which){
  var g=curGame(), r=focusRally();
  if(!r || rallyOpen(r) || !r.shots.length) return;
  var sh=r.shots[r.shots.length-1];
  var newPw = which==='striker'?sh.striker:other(sh.striker);
  if(r.pointWinner===newPw) return;
  clearRedo();
  if(g.done){ S.M.gamesWon[g.winner]-=1; g.done=false; g.winner=null; }
  if(r.pointWinner){ g[r.pointWinner]-=1; }
  r.pointWinner=newPw; g[newPw]+=1; S.M.server=newPw; checkGame(g);
  // No marker pushed: flip modifies an already-closed rally in place, so it's reversed by undoing
  // that rally's close (the close already carries a marker). checkGame() ran recomputeMatchOver.
  requestRender();
}

// ---------- decision popover (who gets the point on a "stroke" or "no let" outcome) ----------
// Session-only UI state — never saved, never mutates M. Opening/cancelling it changes nothing;
// only picking a player calls setOutcome, exactly like any other outcome chip. Serves both
// 'stroke' (point TO the picked player) and 'no_let' (point AGAINST the picked player) — the
// picked outcome is stashed in S.decisionOutcome so the spA/spB handlers know which to apply.
export function tryOpenStrokePopover(outcome){
  var r=focusRally();
  if(!r || !r.shots.length){ toast('Tap a strike first'); return; }
  S.decisionOutcome = outcome || 'stroke';
  S.strokePopoverOpen=true;
  document.getElementById('spA').textContent=S.M.playerA;
  document.getElementById('spB').textContent=S.M.playerB;
  document.querySelector('#strokePop .spTitle').textContent =
    S.decisionOutcome==='no_let' ? 'No let — called against:' : 'Stroke — point to:';
  document.getElementById('strokePop').style.display='block';
}
export function hideStrokePopover(){
  S.strokePopoverOpen=false;
  document.getElementById('strokePop').style.display='none';
}
