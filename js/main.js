// ---------- main: boot + DOM wiring ----------
// This module is loaded as <script type="module"> (deferred), so the DOM is fully parsed before it
// runs. It registers the render callback, initialises persisted state, assigns the global YouTube
// callback, wires every DOM listener/keyboard shortcut/focus fix, then boots with an initial render.
import { S, setRenderCallback, requestRender, liveGameIdx, focusRally, rallyOpen } from './state.js';
import { freshMatch, other } from './model.js';
import { load, loadSeekLead, loadSound, loadAutoResume, loadTourSeen,
         saveSeekLead, saveSound, saveAutoResume, save, isIncompatible, migrate } from './persistence.js';
import { openTour } from './tour.js';
import { onYouTubeIframeAPIReady, parseId, cueVideo, seek, setRate, vt, fmt, parseTimeInput, getPlayer } from './youtube.js';
import { playZoneBlip } from './audio.js';
import { toast } from './toast.js';
import { currentEditShot } from './court.js';
import { setOutcome, tryOpenStrokePopover, hideStrokePopover, flipPoint, recomputeMatchOver } from './outcomes.js';
import { awardPoint, awardGame, awardMatch, resetCurrentGame, clearRally } from './awards.js';
import { undo, redo } from './history.js';
import { insertShot, deleteShot, overwriteFromShot } from './edit.js';
import { exportJson, exportCsv, parseCsv, matchFromCsv, applyImportedMatch, openImportPicker, currentImportMode } from './importexport.js';
import { renderAnalytics } from './analytics.js';
import { renderAll, renderScore, renderTape, renderLead, renderSoundToggle, renderAutoResumeToggle } from './render.js';

// render decoupling + persisted-state init (must happen before any render or listener reads them)
setRenderCallback(renderAll);
S.M = load() || freshMatch();
S.seekLead = loadSeekLead();
S.soundOn = loadSound();
S.autoResume = loadAutoResume();

// the YouTube iframe api (a classic script in index.html) calls this global once it's ready. It can
// fire before this deferred module assigns the global (losing the event), so if YT is already loaded
// we run the callback ourselves to recover it — otherwise the player is never created (black frame).
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
if(window.YT && window.YT.Player) onYouTubeIframeAPIReady();

// ---------- wire up ----------
document.getElementById('loadBtn').addEventListener('click',function(){
  var id=parseId(document.getElementById('vidurl').value);
  S.M.playerA=document.getElementById('inA').value||'Player A';
  S.M.playerB=document.getElementById('inB').value||'Player B';
  if(!id){ toast('Could not read a YouTube ID from that URL'); renderScore(); return; }
  cueVideo(id); renderAll(); toast('Video loaded');
});
document.getElementById('inA').addEventListener('input',function(){ S.M.playerA=this.value||'Player A'; renderScore(); renderTape(); save(); });
document.getElementById('inB').addEventListener('input',function(){ S.M.playerB=this.value||'Player B'; renderScore(); renderTape(); save(); });
document.getElementById('serveBtn').addEventListener('click',function(){
  var r=focusRally();
  if(r && rallyOpen(r) && r.shots.length>0){
    toast('Serve can only be changed before the serve or between rallies'); return;
  }
  S.M.server=other(S.M.server);
  if(r && rallyOpen(r) && r.shots.length===0){ r.server=S.M.server; } // not yet started
  renderAll();
});

document.getElementById('back5').addEventListener('click',function(){seek(-5);});
document.getElementById('back2').addEventListener('click',function(){seek(-2);});
document.getElementById('fwd2').addEventListener('click',function(){seek(2);});
document.getElementById('playBtn').addEventListener('click',togglePlay);
function togglePlay(){ var player=getPlayer(); if(!player) return; var st=player.getPlayerState(); if(st===YT.PlayerState.PLAYING) player.pauseVideo(); else player.playVideo(); }
document.getElementById('r025').addEventListener('click',function(){setRate(0.25);});
document.getElementById('r05').addEventListener('click',function(){setRate(0.5);});
document.getElementById('r075').addEventListener('click',function(){setRate(0.75);});
document.getElementById('r1').addEventListener('click',function(){setRate(1);});

document.querySelectorAll('.chip.contact').forEach(function(b){ b.addEventListener('click',function(){
  var sh=currentEditShot(); if(sh){ sh.contact=this.dataset.c; renderAll(); }
});});
document.querySelectorAll('.chip[data-o]').forEach(function(b){ b.addEventListener('click',function(){
  if(this.dataset.o==='stroke'||this.dataset.o==='no_let'){ tryOpenStrokePopover(this.dataset.o); return; }
  setOutcome(this.dataset.o);
});});
document.getElementById('spA').addEventListener('click',function(){ hideStrokePopover(); setOutcome(S.decisionOutcome,'A'); });
document.getElementById('spB').addEventListener('click',function(){ hideStrokePopover(); setOutcome(S.decisionOutcome,'B'); });
document.getElementById('spCancel').addEventListener('click',function(){ hideStrokePopover(); });
document.addEventListener('pointerdown',function(e){
  if(!S.strokePopoverOpen) return;
  var pop=document.getElementById('strokePop');
  if(pop.contains(e.target)) return;
  if(e.target.closest('.chip[data-o="stroke"],.chip[data-o="no_let"]')) return; // let the trigger's own click handler run
  hideStrokePopover();
});
document.querySelectorAll('.chip.flip').forEach(function(b){ b.addEventListener('click',function(){ flipPoint(this.dataset.f); });});
document.getElementById('editSrc').addEventListener('click',function(){ S.armZone=S.armZone==='start'?null:'start'; renderAll(); });
document.getElementById('editTgt').addEventListener('click',function(){ S.armZone=S.armZone==='end'?null:'end'; renderAll(); });
document.getElementById('selBanner').addEventListener('click',function(e){
  var act=e.target.dataset.act; if(!act) return;
  if(act==='resume'){ S.selectedShot=null; renderAll(); }
  else if(act==='insbefore'){ insertShot('before'); }
  else if(act==='insafter'){ insertShot('after'); }
  else if(act==='delete'){ if(confirm('Delete this shot?')) deleteShot(); }
  else if(act==='overwrite'){ overwriteFromShot(); }
});
document.getElementById('undoBtn').addEventListener('click',undo);
document.getElementById('redoBtn').addEventListener('click',redo);
document.getElementById('setTimeBtn').addEventListener('click',function(){
  var sh=currentEditShot(); var t=vt();
  if(!sh){ toast('No shot selected'); return; }
  if(t==null){ toast('Load and play the video first'); return; }
  sh.t=t; renderAll(); toast('Time set — '+fmt(t));
});
document.getElementById('timeEdit').addEventListener('change',function(){
  var sh=currentEditShot();
  if(!sh){ toast('No shot selected'); return; }
  var parsed=parseTimeInput(this.value);
  if(isNaN(parsed)){ toast('Enter a time like 1:23.4 or 83.4'); renderAll(); return; }
  sh.t=parsed; renderAll(); toast('Time set — '+fmt(sh.t));
});

// best-of toggle + review-lead stepper (lead is a per-browser preference, not match data)
document.querySelectorAll('.boBtn').forEach(function(b){ b.addEventListener('click',function(){
  S.M.bestOf=+this.dataset.bo; recomputeMatchOver(); renderAll();
});});
document.getElementById('leadMinus').addEventListener('click',function(){ S.seekLead=Math.max(0,S.seekLead-1); saveSeekLead(); renderLead(); });
document.getElementById('leadPlus').addEventListener('click',function(){ S.seekLead=Math.min(15,S.seekLead+1); saveSeekLead(); renderLead(); });
renderLead();

// sound / auto-resume toggles — per-browser preferences
document.getElementById('soundToggle').addEventListener('click',function(){ S.soundOn=!S.soundOn; saveSound(); renderSoundToggle(); if(S.soundOn) playZoneBlip('FL'); });
renderSoundToggle();
document.getElementById('autoResumeToggle').addEventListener('click',function(){ S.autoResume=!S.autoResume; saveAutoResume(); renderAutoResumeToggle(); });
renderAutoResumeToggle();

// tape: click a shot row to edit it; click a collapsed rally summary to expand/collapse it
document.getElementById('tape').addEventListener('click',function(e){
  var clearEl=e.target.closest('[data-clear-g]');
  if(clearEl){ clearRally(+clearEl.dataset.clearG, +clearEl.dataset.clearR); return; }
  var row=e.target.closest('.shotrow');
  if(row){
    var gi=+row.dataset.g, ri=+row.dataset.r, si=+row.dataset.s;
    var game=S.M.games[gi-1]; var rally=game && game.rallies[ri-1]; var sh=rally && rally.shots[si];
    if(!sh) return;
    if(S.selectedShot && S.selectedShot.shot===sh){ S.selectedShot=null; }     // second click deselects, no seek
    else {
      S.selectedShot={shot:sh, gameNo:gi, rallyNo:ri, idx:si};
      // jump the replay to just before this shot so the action plays toward you (offsets tag lag)
      var player=getPlayer();
      if(player && player.seekTo && sh.t!=null){ player.seekTo(Math.max(0,sh.t-S.seekLead),true); }
    }
    renderAll(); return;
  }
  var sum=e.target.closest('.rallysum');
  if(sum){
    var g2=+sum.dataset.toggleG, r2=+sum.dataset.toggleR;
    S.expandedRally = (S.expandedRally && S.expandedRally.g===g2 && S.expandedRally.r===r2) ? null : {g:g2,r:r2};
    renderAll();
  }
});
// game pills: pin the tape to a past game for browsing; tagging always stays live
document.getElementById('gamePills').addEventListener('click',function(e){
  var p=e.target.closest('.gpill'); if(!p) return;
  var idx=+p.dataset.gi;
  S.viewGameIdx = (idx===liveGameIdx()) ? null : idx;
  S.selectedShot=null; S.expandedRally=null; renderAll();
});

document.getElementById('awardPtA').addEventListener('click',function(){ awardPoint('A'); });
document.getElementById('awardPtB').addEventListener('click',function(){ awardPoint('B'); });
document.getElementById('awardGameA').addEventListener('click',function(){ awardGame('A'); });
document.getElementById('awardGameB').addEventListener('click',function(){ awardGame('B'); });
document.getElementById('awardMatchA').addEventListener('click',function(){ awardMatch('A'); });
document.getElementById('awardMatchB').addEventListener('click',function(){ awardMatch('B'); });
document.getElementById('resetGameBtn').addEventListener('click',resetCurrentGame);

document.getElementById('exportJson').addEventListener('click',exportJson);
// each import pill picks its own format: it sets the mode + the file input's accept filter, then
// opens the shared hidden input. The change handler parses strictly per that mode — no fallback.
document.getElementById('importJson').addEventListener('click',function(){ openImportPicker('json','.json,application/json'); });
document.getElementById('importCsv').addEventListener('click',function(){ openImportPicker('csv','.csv,text/csv'); });
document.getElementById('importFile').addEventListener('change',function(e){
  var f=e.target.files && e.target.files[0]; e.target.value=''; // clear so re-picking the same file fires change again
  if(!f) return;
  var mode=currentImportMode();
  var reader=new FileReader();
  reader.onload=function(){
    var obj=null;
    if(mode==='csv'){
      var rows=parseCsv(String(reader.result));
      if(!rows.length || rows[0].indexOf('match_id')<0){ toast('Could not parse that file — not a RallyTracer CSV export'); return; }
      obj=matchFromCsv(rows);
      if(!obj) return; // matchFromCsv already toasted why
    } else {
      try{ obj=JSON.parse(reader.result); }
      catch(err){ toast('Could not parse that file — not valid JSON'); return; }
    }
    if(!obj || !Array.isArray(obj.games) || !obj.id){ toast("That file doesn't look like a match export"); return; }
    if(isIncompatible(obj)){ toast("That export uses the old 9-zone court and can't be imported."); return; }
    obj=migrate(obj);
    applyImportedMatch(obj);
  };
  reader.onerror=function(){ toast('Could not read that file'); };
  reader.readAsText(f);
});
// live analytics: tab/scope pills, metric toggle (delegated, since it's inside a rebuilt pane),
// and re-render on open (renderAll only recomputes/renders while the panel is open)
document.getElementById('analyticsPanel').addEventListener('toggle',function(){ if(this.open) renderAnalytics(); });
document.querySelectorAll('[data-atab]').forEach(function(b){ b.addEventListener('click',function(){
  S.analyticsTab=this.dataset.atab;
  document.querySelectorAll('[data-atab]').forEach(function(x){ x.classList.toggle('on', x===b); });
  renderAnalytics();
});});
document.querySelectorAll('[data-ascope]').forEach(function(b){ b.addEventListener('click',function(){
  S.analyticsScope=this.dataset.ascope;
  document.querySelectorAll('[data-ascope]').forEach(function(x){ x.classList.toggle('on', x===b); });
  renderAnalytics();
});});
document.getElementById('anaBody').addEventListener('click',function(e){
  var m=e.target.closest('[data-ametric]');
  if(m){ S.analyticsCourtMetric=m.dataset.ametric; renderAnalytics(); }
});

document.getElementById('exportCsv').addEventListener('click',exportCsv);
document.getElementById('guideBtn').addEventListener('click',openTour);
document.getElementById('newMatch').addEventListener('click',function(){
  if(!confirm('Start a new match? Current match stays exported only if you saved it.')) return;
  var vid=S.M.videoId, a=S.M.playerA, b=S.M.playerB, bo=S.M.bestOf;
  S.M=freshMatch(); S.M.videoId=vid; S.M.playerA=a; S.M.playerB=b; S.M.bestOf=bo; S.armZone=null;
  S.selectedShot=null; S.viewGameIdx=null; S.expandedRally=null; S.actionStack=[]; S.redoStack=[];
  S.awaitingTarget=false;
  renderAll(); toast('New match');
});

// ---------- keyboard shortcuts ----------
document.addEventListener('keydown',function(e){
  if(/input|textarea/i.test((e.target.tagName||''))) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return; // never hijack Ctrl/Cmd/Alt combos
  var key=e.key, code=e.code;

  // the stroke popover, if open, owns Escape ahead of everything else below
  if(S.strokePopoverOpen && key==='Escape'){ e.preventDefault(); hideStrokePopover(); return; }
  if(key==='Escape' && S.selectedShot){ e.preventDefault(); S.selectedShot=null; renderAll(); return; }

  if(code==='Space'){ e.preventDefault(); togglePlay(); return; }
  if(key==='z'||key==='Z'){ undo(); return; }
  if(key==='y'||key==='Y'){ redo(); return; }
  if(key==='ArrowLeft'){ e.preventDefault(); seek(e.shiftKey?-5:-2); return; }
  if(key==='ArrowRight'){ e.preventDefault(); seek(e.shiftKey?5:2); return; }
  if(key==='w'||key==='W'){ setOutcome('winner'); return; }
  if(key==='u'||key==='U'){ setOutcome('unforced_error'); return; }
  if(key==='f'||key==='F'){ setOutcome('forced_error'); return; }
  if(key==='s'||key==='S'){ tryOpenStrokePopover(); return; }
  if(key==='l'||key==='L'){ setOutcome('let'); return; }
  if(key==='n'||key==='N'){ tryOpenStrokePopover('no_let'); return; }
});

// ---------- iframe focus fix ----------
// Once the user clicks inside the YouTube iframe, keydown events go to the iframe and every
// shortcut above goes dead (no error, just silence) — this makes that state visible and recoverable.
function playerHasFocus(){
  var ae=document.activeElement, playerEl=document.getElementById('player');
  return !!(ae && playerEl && ae.tagName==='IFRAME' && playerEl.contains(ae));
}
function showKbWarn(on){ var el=document.getElementById('kbWarn'); if(el) el.style.display=on?'inline':'none'; }
window.addEventListener('blur',function(){
  setTimeout(function(){ if(playerHasFocus()) showKbWarn(true); },50);
});
window.addEventListener('focus',function(){ showKbWarn(false); });
// clicking anywhere outside the iframe (and outside form controls) blurs it so keys work again,
// without stealing focus away from a genuine input/textarea/button the user meant to click.
document.addEventListener('pointerdown',function(e){
  var playerEl=document.getElementById('player');
  if(playerEl && playerEl.contains(e.target)) return; // clicks on the video itself are left alone
  if(/input|textarea|button/i.test(e.target.tagName||'')) return;
  if(playerHasFocus()){
    try{ document.activeElement.blur(); }catch(_){}
    showKbWarn(false);
  }
});

// boot
if(location.protocol==='file:'){ document.getElementById('fileWarn').style.display='flex'; }
if(S.M.videoId){ document.getElementById('vidurl').value='https://youtu.be/'+S.M.videoId; }
renderAll();
if(!loadTourSeen()) openTour();
