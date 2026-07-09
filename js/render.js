// ---------- rendering ----------
import { S, nm, focusRally, curGame, rallyOpen, viewedGame, isViewingLive, liveGameIdx, viewIdx } from './state.js';
import { ALL_STROKES } from './model.js';
import { paintZones, currentEditShot, isOutcomeEditable, tapMode } from './court.js';
import { chainBroken, selectedRally } from './edit.js';
import { fmt } from './youtube.js';
import { hideStrokePopover } from './outcomes.js';
import { renderAnalytics } from './analytics.js';
import { save } from './persistence.js';

var OUT_SYM={winner:'★',unforced_error:'@',forced_error:'#',stroke:'S',no_let:'N',let:'L'};
var OUT_CLS={winner:'w',unforced_error:'e',forced_error:'e',stroke:'s',no_let:'n',let:'l'};

// ---------- game pills (read-only browsing of past games; tagging is always live) ----------
function renderGamePills(){
  var box=document.getElementById('gamePills');
  if(S.M.games.length<2){ box.innerHTML=''; box.style.display='none'; return; }
  box.style.display='flex';
  var live=liveGameIdx(), cur=viewIdx();
  box.innerHTML=S.M.games.map(function(g,i){
    var cls='gpill'+(i===cur?' on':'');
    return '<span class="'+cls+'" data-gi="'+i+'">G'+g.no+(i===live?'<span class="ld"></span>':'')+'</span>';
  }).join('');
}

// ---------- tape: live ledger + collapsible history, scoped to the viewed game ----------
function lastShotDesc(sh){
  if(!sh) return '';
  var lbl = sh.stroke || (sh.start ? (sh.start+(sh.end?'→'+sh.end:'')) : '?');
  return lbl+' '+(OUT_SYM[sh.outcome]||'');
}
function rallySummaryText(r){
  if(r.outcome==='let') return 'let, replay';
  if(r.pointWinner) return nm(r.pointWinner)+' wins · '+lastShotDesc(r.shots[r.shots.length-1]);
  return 'in progress';
}
// scoreAfterRally: tallies pointWinner across g.rallies up to and including targetRally (lets and
// still-open rallies don't score). O(rallies) — fine at match sizes, presentational only.
function scoreAfterRally(g,targetRally){
  var a=0,b=0;
  for(var i=0;i<g.rallies.length;i++){
    var r=g.rallies[i];
    if(r.pointWinner==='A') a++; else if(r.pointWinner==='B') b++;
    if(r===targetRally) break;
  }
  return a+'-'+b;
}
function shotRowHtml(gameNo,r,sh,i){
  var isLast=i===r.shots.length-1;
  var pend = sh.end==null;
  var isTerm = sh.outcome && sh.outcome!=='in_play';
  var sel = S.selectedShot && S.selectedShot.shot===sh;
  var cls='shotrow'+(pend&&!isTerm?' pend':'')+(isTerm?' term '+OUT_CLS[sh.outcome]:'')+(sel?' sel':'');
  var strokeLbl = sh.idx===0 ? 'serve' : (sh.stroke || '<span style="color:var(--dim)">·</span>');
  var path = (sh.start||'?')+' → '+(sh.end||'?')+' · '+strokeLbl;
  var tail = '<span class="outmark">'+(isTerm?OUT_SYM[sh.outcome]:'')+'</span>';
  var flag = chainBroken(r,i) ? ' <span class="flagmark" title="end zone doesn\'t match the next shot\'s start zone">!</span>' : '';
  // incomplete = a mid-rally shot left unresolved (no end zone) — typically an inserted row not
  // yet filled in. Distinct from the legitimate live trailing pending shot (i is the last index).
  var incomplete = sh.end==null && !isTerm && i<r.shots.length-1;
  var inc = incomplete ? ' <span class="incmark" title="shot is missing its end zone">◌</span>' : '';
  var tc = '<span class="rtc">'+(sh.t!=null?fmt(sh.t):'')+'</span>';
  return '<div class="'+cls+'" data-g="'+gameNo+'" data-r="'+r.no+'" data-s="'+i+'">'
    +'<span class="sn">'+(i+1)+'</span>'
    +'<span class="pl" title="'+nm(sh.striker)+'">'+nm(sh.striker)+'</span>'
    +'<span class="pth">'+path+flag+inc+'</span>'
    +tail
    +tc
    +'</div>';
}
function rallyShotsHtml(gameNo,r){
  var g=S.M.games[gameNo-1];
  var html=r.shots.map(function(sh,i){ return shotRowHtml(gameNo,r,sh,i); }).join('');
  if(!rallyOpen(r) && r.pointWinner) html+='<div class="rallyfoot">point '+nm(r.pointWinner)+' · '+scoreAfterRally(g,r)+'</div>';
  else if(!rallyOpen(r) && r.outcome==='let') html+='<div class="rallyfoot">let — replay · '+scoreAfterRally(g,r)+'</div>';
  return html;
}
function renderTape(){
  var tape=document.getElementById('tape');
  var vg=viewedGame();
  if(!vg || !vg.rallies.length){ tape.innerHTML='<span class="tape-empty">No shots yet.</span>'; return; }
  var history=vg.rallies.slice(0,-1), tail=vg.rallies[vg.rallies.length-1];
  var html='';
  if(history.length){
    html+='<div class="hist">'+history.map(function(r){
      var isExp=S.expandedRally && S.expandedRally.g===vg.no && S.expandedRally.r===r.no;
      var head='<div class="rallysum'+(isExp?' open':'')+'" data-toggle-g="'+vg.no+'" data-toggle-r="'+r.no+'">'
        +(isExp?'▾ ':'▸ ')+'R'+r.no+' · '+r.shots.length+' shots · '+rallySummaryText(r)+' · '+scoreAfterRally(vg,r)
        +' · <span class="link" data-clear-g="'+vg.no+'" data-clear-r="'+r.no+'">clear</span></div>';
      return isExp ? head+'<div class="ledger">'+rallyShotsHtml(vg.no,r)+'</div>' : head;
    }).join('')+'</div><div class="taildiv"></div>';
  }
  if(tail.shots.length){
    html+='<div class="ledger tail">'+rallyShotsHtml(vg.no,tail)+'</div>';
    if(isViewingLive() && rallyOpen(tail)) html+='<div class="rallyfoot"><span class="link" data-clear-g="'+vg.no+'" data-clear-r="'+tail.no+'">clear rally</span></div>';
  } else {
    var srv = vg.done ? nm(S.M.server) : nm(tail.server);
    html+='<span class="tape-empty">'+(vg.done?'Game complete.':'Rally '+tail.no+' — '+srv+' to serve. Tap the side the serve is struck from.')+'</span>';
  }
  tape.innerHTML=html;
  if(isViewingLive() && !S.expandedRally) tape.scrollTop=tape.scrollHeight;
}

// ---------- editor ----------
function renderStrokeChips(sh,container){
  container.innerHTML='';
  if(sh.idx===0){
    var fixed=document.createElement('span'); fixed.style.cssText='font-family:var(--mono);font-size:11px;color:var(--mut)';
    fixed.textContent='serve (fixed)'; container.appendChild(fixed); return;
  }
  if(sh.end==null){
    var wait=document.createElement('span'); wait.style.cssText='font-family:var(--mono);font-size:11px;color:var(--dim)';
    wait.textContent = S.awaitingTarget ? 'tap the court for the landing zone…' : 'stroke resolves once the next strike is tapped';
    container.appendChild(wait); return;
  }
  ALL_STROKES.forEach(function(c){
    var on = sh.stroke===c;
    var b=document.createElement('button');
    b.className='chip'+(on?' on':'');
    b.textContent=c;
    b.addEventListener('click',function(){ sh.stroke = on ? null : c; renderAll(); });
    container.appendChild(b);
  });
}
// renderEditor has two modes: LIVE (selectedShot==null — normal tagging flow, shows only the
// end-rally outcome row against focusRally()'s own last shot) and EDIT (a tape row was clicked —
// shows stroke/contact/zones for that shot, plus the outcome row only under isOutcomeEditable()'s
// history-safety rule). See the block comment above isOutcomeEditable() for why history edits are
// restricted that way.
// renderTimeEdit keeps #timeEdit in sync with the shot currentEditShot() resolves to (live or
// edit mode), without clobbering the field while the user is actively typing in it — same guard
// renderScore() uses for the player-name inputs.
function renderTimeEdit(){
  var el=document.getElementById('timeEdit');
  if(document.activeElement===el) return;
  var sh=currentEditShot();
  if(!sh){ el.value=''; el.disabled=true; return; }
  el.disabled=false; el.value=fmt(sh.t)==='–' ? '' : fmt(sh.t);
}
function renderEditor(){
  var ed=document.getElementById('editor');
  var banner=document.getElementById('selBanner');
  var strokeRow=document.getElementById('strokeRow');
  var contactRow=document.getElementById('contactRow');
  var zonesRow=document.getElementById('zonesRow');
  var outcomeRow=document.getElementById('outcomeRow');
  var flipRow=document.getElementById('flipRow');
  renderTimeEdit();

  if(!S.selectedShot){
    strokeRow.style.display='none'; contactRow.style.display='none'; zonesRow.style.display='none';
    banner.style.display='none';
    var r=focusRally();
    if(!r || !r.shots.length){
      ed.classList.add('empty'); outcomeRow.style.display='none'; flipRow.style.display='none';
      return;
    }
    ed.classList.remove('empty'); outcomeRow.style.display='flex';
    var lastSh=r.shots[r.shots.length-1], closed=!rallyOpen(r);
    document.querySelectorAll('.chip[data-o]').forEach(function(b){ b.classList.toggle('on', closed && b.dataset.o===lastSh.outcome); });
    flipRow.style.display=(closed && (lastSh.outcome==='stroke'||lastSh.outcome==='no_let'))?'flex':'none';
    return;
  }

  var sh=currentEditShot();
  if(!sh){
    ed.classList.add('empty'); banner.style.display='none';
    strokeRow.style.display='none'; contactRow.style.display='none'; zonesRow.style.display='none';
    outcomeRow.style.display='none'; flipRow.style.display='none';
    return;
  }
  ed.classList.remove('empty');
  strokeRow.style.display='flex'; contactRow.style.display='flex'; zonesRow.style.display='flex';
  banner.style.display='block';
  var r2=selectedRally();
  var canStructEdit = r2 && !rallyOpen(r2);
  // "re-tag from here" is available whenever the selected shot sits in the live focus rally,
  // whether that rally is open or closed — unlike insert/delete it's not gated to closed rallies
  // (mid-rally redo is the main use case).
  var canOverwrite = r2 && r2===focusRally() && S.selectedShot.gameNo===S.M.games.length;
  // action links live on their own flex row (each is a span, no bare text nodes) so they don't
  // interleave with the sentence above the way a flexed mixed text/span container did
  var acts=[];
  if(canStructEdit){
    acts.push('<span class="link" data-act="insbefore">+ before</span>');
    acts.push('<span class="link" data-act="insafter">+ after</span>');
    acts.push('<span class="link danger" data-act="delete">delete</span>');
  }
  if(canOverwrite) acts.push('<span class="link" data-act="overwrite">re-tag from here</span>');
  banner.innerHTML='<div class="selmsg">Editing R'+S.selectedShot.rallyNo+' · shot '+(S.selectedShot.idx+1)+' — tap the court to resume live, or <span class="link" data-act="resume">resume now</span></div>'
    +(acts.length?'<div class="selacts">'+acts.join('')+'</div>':'');

  renderStrokeChips(sh, document.getElementById('strokeChips'));
  document.querySelectorAll('.chip.contact').forEach(function(b){ b.classList.toggle('on', b.dataset.c===sh.contact); });
  document.getElementById('zoneRead').textContent=(sh.start||'?')+' → '+(sh.end||'?')+(sh.direction?(' · '+sh.direction):'');
  document.getElementById('editSrc').classList.toggle('arm',S.armZone==='start');
  var tgtBtn=document.getElementById('editTgt');
  tgtBtn.style.display = sh.end!=null ? '' : 'none';
  tgtBtn.classList.toggle('arm',S.armZone==='end');
  if(S.armZone==='end' && sh.end==null) S.armZone=null;

  var canOutcome=isOutcomeEditable(sh);
  outcomeRow.style.display=canOutcome?'flex':'none';
  if(canOutcome) document.querySelectorAll('.chip[data-o]').forEach(function(b){ b.classList.toggle('on', b.dataset.o===sh.outcome); });
  flipRow.style.display=(canOutcome && (sh.outcome==='stroke'||sh.outcome==='no_let'))?'flex':'none';
}

// renders games-won as filled/unfilled dots (needed-to-win dots, e.g. 3 for best-of-5) into el
function renderGameDots(el, won, bestOf){
  var need = Math.ceil((bestOf||5)/2);
  var html='';
  for(var i=0;i<need;i++) html += '<span class="gdot'+(i<won?' on':'')+'"></span>';
  el.innerHTML = html;
}
function renderScore(){
  // don't clobber the caret while the user is actively typing in a name field
  var inA=document.getElementById('inA'), inB=document.getElementById('inB');
  if(document.activeElement!==inA) inA.value=S.M.playerA;
  if(document.activeElement!==inB) inB.value=S.M.playerB;
  var g=curGame();
  document.getElementById('ptsA').textContent=g?g.A:0; document.getElementById('ptsB').textContent=g?g.B:0;
  renderGameDots(document.getElementById('gmA'), S.M.gamesWon.A, S.M.bestOf);
  renderGameDots(document.getElementById('gmB'), S.M.gamesWon.B, S.M.bestOf);
  document.getElementById('scA').classList.toggle('serving',S.M.server==='A');
  document.getElementById('scB').classList.toggle('serving',S.M.server==='B');
  var moc=document.getElementById('matchOverChip');
  if(S.M.matchOver){ moc.style.display='inline'; moc.textContent='match: '+nm(S.M.matchWinner); }
  else { moc.style.display='none'; }
  document.getElementById('serveBtn').textContent='Server: '+nm(S.M.server)+' ⇄';
  // award pills in Match controls track the player names live (renderScore runs on name input)
  document.getElementById('awardPtA').textContent=nm('A');
  document.getElementById('awardPtB').textContent=nm('B');
  document.getElementById('awardGameA').textContent=nm('A');
  document.getElementById('awardGameB').textContent=nm('B');
  document.getElementById('awardMatchA').textContent=nm('A');
  document.getElementById('awardMatchB').textContent=nm('B');
  var tm=tapMode();
  var lab='—';
  if(tm.mode==='landing') lab='tap landing';
  else if(tm.mode==='serve'||tm.mode==='newrally') lab=nm(tm.server)+' serves';
  else if(tm.mode==='strike') lab=nm(tm.striker)+' to hit';
  else if(tm.mode==='newgame') lab=nm(S.M.server)+' serves';
  else if(tm.mode==='arm') lab='editing zone';
  document.getElementById('strikerLab').textContent=lab;
  var hint=document.getElementById('hint'); var cw=document.getElementById('courtWrap');
  if(tm.mode==='arm'){ hint.innerHTML='Tap a zone to set the <b>'+S.armZone+'</b> of the edited shot.'; }
  else if(tm.mode==='landing'){ hint.innerHTML='Tap where that shot <b>landed</b>.'; }
  else if(tm.mode==='newgame'){ hint.innerHTML='Game '+g.no+' complete — tap the <b>side</b> the next serve is struck from to start game '+(g.no+1)+'.'; }
  else if(tm.mode==='newrally'){ hint.innerHTML='Rally closed — tap the <b>side</b> the next serve is struck from.'; }
  else if(tm.mode==='serve'){ hint.innerHTML='Tap the <b>side</b> the serve is struck from.'; }
  else { hint.innerHTML='Tap where the next strike happens — or pick an <b>end-rally</b> outcome below.'; }
  // pulse the court only when a tap is genuinely required right now (landing a winner/error, or
  // editing a zone) — not constantly, which the old unconditional add() did.
  cw.classList.toggle('await', tm.mode==='landing' || tm.mode==='arm');
  document.getElementById('bestOfLab').textContent='best of '+(S.M.bestOf||5);
  document.querySelectorAll('.boBtn').forEach(function(b){ b.classList.toggle('on', +b.dataset.bo===(S.M.bestOf||5)); });
}

// per-browser preference renderers (called by their steppers/toggles in main.js and at boot)
function renderLead(){ document.getElementById('leadLab').textContent=S.seekLead+' s'; }
function renderSoundToggle(){ var b=document.getElementById('soundToggle'); b.textContent=S.soundOn?'On':'Off'; b.classList.toggle('on',S.soundOn); }
function renderAutoResumeToggle(){ var b=document.getElementById('autoResumeToggle'); b.textContent=S.autoResume?'On':'Off'; b.classList.toggle('on',S.autoResume); }

function renderAll(){
  if(S.strokePopoverOpen) hideStrokePopover(); // defensive: nothing should mutate state while it's open
  paintZones(); renderGamePills(); renderTape(); renderEditor(); renderScore(); save();
  var ap=document.getElementById('analyticsPanel');
  if(ap && ap.open) renderAnalytics();
}

export { renderAll, renderScore, renderTape, renderLead, renderSoundToggle, renderAutoResumeToggle };
