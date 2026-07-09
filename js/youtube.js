// ---------- YouTube ----------
// Owns its own player/rate/ytReady/pendingVideo state (NOT in S). Exports the transport/timecode
// surface used by court/render/main. onYouTubeIframeAPIReady is exported and assigned to
// window.onYouTubeIframeAPIReady by main.js (the YT iframe api is a classic script that calls it).
import { S } from './state.js';
import { save } from './persistence.js';

var player=null, ytReady=false, pendingVideo=null, rate=1;

// getPlayer exposes the module-private YT.Player instance to the few callers that need it (court's
// auto-resume, main's play/pause + seek-on-select). Was a shared closure var in the single-file app.
export function getPlayer(){ return player; }

export function onYouTubeIframeAPIReady(){ ytReady=true; if(pendingVideo) cueVideo(pendingVideo); else if(S.M.videoId) cueVideo(S.M.videoId); }
export function parseId(url){
  if(!url) return null;
  var m=url.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  if(m) return m[1];
  if(/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}
export function cueVideo(id){
  S.M.videoId=id; document.getElementById('vidEmpty').style.display='none';
  if(!ytReady){ pendingVideo=id; return; }
  if(player){ player.cueVideoById(id); }
  else{
    player=new YT.Player('player',{ videoId:id,
      playerVars:{rel:0,modestbranding:1,playsinline:1,origin:window.location.origin},
      events:{ 'onReady':function(){}, 'onStateChange':onState } });
  }
  save();
}
function onState(e){
  var b=document.getElementById('playBtn');
  if(e.data===YT.PlayerState.PLAYING) b.textContent='Pause';
  else b.textContent='Play';
}
export function vt(){ try{ return player&&player.getCurrentTime?+player.getCurrentTime().toFixed(2):null; }catch(_){ return null; } }
// tagTime = vt() minus the tagger's reaction lag, converted from real seconds to video seconds via
// the current playback rate. Used ONLY when a NEW shot is first stamped (onZone) — never for the
// manual "set time = now" stamp, which is a deliberate correction, not a lag-compensated capture.
export function tagTime(){ var t=vt(); if(t==null) return null; return +t.toFixed(2); }
export function fmt(t){ if(t==null) return '–'; var m=Math.floor(t/60), s=(t%60); return m+':'+(s<10?'0':'')+s.toFixed(1); }
// parseTimeInput: "m:ss(.s)" -> minutes*60+seconds; otherwise plain float seconds. Returns a
// number>=0 rounded to 2 decimals, or NaN if unparseable/empty (empty is treated as invalid, not
// a clear-to-null, to avoid accidental clears from a stray blur).
export function parseTimeInput(str){
  str=(str||'').trim();
  if(!str) return NaN;
  var t;
  if(str.indexOf(':')>=0){
    var parts=str.split(':');
    if(parts.length!==2) return NaN;
    var mins=+parts[0], secs=+parts[1];
    if(isNaN(mins)||isNaN(secs)) return NaN;
    t=mins*60+secs;
  } else {
    t=+str;
  }
  if(isNaN(t)||t<0) return NaN;
  return +t.toFixed(2);
}
export function seek(d){ if(player&&player.seekTo){ player.seekTo(Math.max(0,(player.getCurrentTime()||0)+d),true);} }
export function setRate(r){ rate=r; if(player&&player.setPlaybackRate) player.setPlaybackRate(r);
  ['r025','r05','r075','r1'].forEach(function(id){document.getElementById(id).classList.remove('on');});
  var id = r===0.25?'r025':r===0.5?'r05':r===0.75?'r075':'r1';
  document.getElementById(id).classList.add('on');
  document.getElementById('rateLab').textContent=r+'×';
}
export function tick(){ document.getElementById('tc').textContent=fmt(vt()); requestAnimationFrame(tick); }
requestAnimationFrame(tick);
