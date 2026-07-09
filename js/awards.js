// ---------- awards / manual match controls ----------
// these are score-affecting actions taken OUTSIDE normal rally tagging (referee awards — conduct,
// injury, retirement — or the tagger manually closing a game/match early). Each is logged as an
// event so it shows up in the tape area and in both exports, distinct from shot data.
import { S, requestRender, clearRedo, nm, curGame } from './state.js';
import { newRally } from './model.js';
import { checkGame, recomputeMatchOver, scoreSnapshot } from './outcomes.js';
import { toast } from './toast.js';

export function logEvent(type,player,detail){
  S.M.events = S.M.events||[];
  var ev={id:++S.evSeq, type:type, player:player||null, gameNo:curGame().no, detail:detail||''};
  S.M.events.push(ev);
  return ev;
}
// logEvent appends the audit entry AND returns it, so callers can stash the same object reference
// in the undo record (so undo removes exactly that entry, not whichever happens to be last).
export function awardPoint(player){
  var g=curGame();
  if(g.done){ toast('Current game is already complete'); return; }
  clearRedo();
  var snap=scoreSnapshot();
  S.awaitingTarget=false; S.selectedShot=null;
  g[player]+=1; S.M.server=player;
  var ev=logEvent('award_point',player,'score '+g.A+'-'+g.B);
  checkGame(g);
  S.actionStack.push({event:ev, snap:snap});
  requestRender(); toast('Point awarded to '+nm(player));
}
export function awardGame(winner){
  var g=curGame();
  if(g.done){ toast('Game is already complete'); return; }
  if(!confirm('Award Game '+g.no+' ('+g.A+'-'+g.B+') to '+nm(winner)+'?')) return;
  clearRedo();
  var snap=scoreSnapshot();
  S.awaitingTarget=false; S.selectedShot=null;
  g.done=true; g.winner=winner; S.M.gamesWon[winner]+=1; S.M.server=winner;
  var ev=logEvent('award_game',winner,'game '+g.no+' ('+g.A+'-'+g.B+')');
  recomputeMatchOver();
  S.actionStack.push({event:ev, snap:snap});
  requestRender(); toast('Game '+g.no+' awarded to '+nm(winner));
}
export function awardMatch(winner){
  if(!confirm('End the match now and award it to '+nm(winner)+'?')) return;
  clearRedo();
  var g=curGame();
  var snap=scoreSnapshot();
  S.awaitingTarget=false; S.selectedShot=null;
  if(!g.done){ g.done=true; g.winner=winner; S.M.gamesWon[winner]+=1; S.M.server=winner; }
  // forcedOver is a manual retirement flag, kept distinct from the auto best-of result so that
  // recomputeMatchOver() can never silently un-end a forced match on a later score change.
  S.M.forcedOver=true; S.M.matchWinner=winner;
  var ev=logEvent('award_match',winner,'match awarded');
  recomputeMatchOver();
  S.actionStack.push({event:ev, snap:snap});
  requestRender(); toast('Match awarded to '+nm(winner));
}
export function resetCurrentGame(){
  var g=curGame();
  if(!confirm('Reset Game '+g.no+'? All shots tagged in this game will be cleared. Earlier games are untouched.')) return;
  clearRedo();
  // snapshot enough to fully reverse the reset: score state, this game's rallies, and the whole
  // events array (we're about to drop this game's prior events, so capture them to restore on undo)
  var snap=scoreSnapshot();
  var rallies=JSON.parse(JSON.stringify(g.rallies));
  var eventsSnap=JSON.parse(JSON.stringify(S.M.events||[]));
  if(g.done && g.winner){ S.M.gamesWon[g.winner]-=1; }
  g.rallies=[newRally(1,S.M.server)]; g.A=0; g.B=0; g.done=false; g.winner=null;
  S.selectedShot=null; S.viewGameIdx=null; S.expandedRally=null;
  // drop now-orphaned events for this game (they reference cleared shots/score), then log the reset
  S.M.events=(S.M.events||[]).filter(function(ev){ return ev.gameNo!==g.no; });
  var ev=logEvent('reset_game',null,'game '+g.no+' reset');
  recomputeMatchOver();
  S.actionStack.push({event:ev, snap:snap, rallies:rallies, eventsSnap:eventsSnap});
  requestRender(); toast('Game '+g.no+' reset');
}

// clearRally wipes ONE rally's shots/outcome in place (it stays in the list, reopened for re-tagging)
// rather than removing it — only ever operates on the live game, exactly like resetCurrentGame but
// scoped to a single rally. Undo is reused verbatim via the same {event,snap,rallies,eventsSnap}
// record shape resetCurrentGame uses, so no new undo-branch code is needed.
export function clearRally(gameNo,rallyNo){
  var live=S.M.games.length-1;
  if(gameNo-1!==live){ toast("Can't clear a rally in a past game — that's browse-only"); return; }
  var g=S.M.games[live];
  var r=g.rallies[rallyNo-1];
  if(!r) return;
  if(!confirm('Clear rally '+rallyNo+'? Its shots are wiped and its point reverted. This rally stays in place to re-tag.')) return;
  clearRedo();
  var snap=scoreSnapshot();
  var rallies=JSON.parse(JSON.stringify(g.rallies));
  var eventsSnap=JSON.parse(JSON.stringify(S.M.events||[]));
  var oldDone=g.done, oldWinner=g.winner;
  r.shots=[]; r.outcome=null; r.pointWinner=null;
  // recompute the whole live game's score/done/winner from its rallies (inlined completion test —
  // NOT checkGame(), which would also mutate M.server and toast)
  g.A=0; g.B=0; g.done=false; g.winner=null;
  g.rallies.forEach(function(rr){
    if(rr.outcome && rr.outcome!=='let' && rr.pointWinner){
      g[rr.pointWinner]+=1;
      if((g.A>=11||g.B>=11) && Math.abs(g.A-g.B)>=2){ g.done=true; g.winner=g.A>g.B?'A':'B'; }
    }
  });
  if(oldDone && (!g.done || g.winner!==oldWinner)) S.M.gamesWon[oldWinner]-=1;
  if(g.done && (!oldDone || g.winner!==oldWinner)) S.M.gamesWon[g.winner]=(S.M.gamesWon[g.winner]||0)+1;
  recomputeMatchOver();
  S.selectedShot=null; S.awaitingTarget=false; S.expandedRally=null;
  var ev=logEvent('clear_rally',null,'R'+rallyNo+' cleared');
  S.actionStack.push({event:ev, snap:snap, rallies:rallies, eventsSnap:eventsSnap});
  requestRender(); toast('Rally cleared');
}

export function revertRallyClose(r){
  var g=curGame();
  if(g.done){ S.M.gamesWon[g.winner]-=1; g.done=false; g.winner=null; }
  if(r.pointWinner){ g[r.pointWinner]-=1; }
  S.M.server=r.server;
  r.outcome=null; r.pointWinner=null;
  recomputeMatchOver();
}
export function reopenAsPending(sh){
  sh.outcome='in_play'; sh.end=null;
  if(sh.idx!==0){ sh.stroke=null; sh.direction=null; }
}
