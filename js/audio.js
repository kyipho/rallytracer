// ---------- audio confirmation ----------
// AudioContext is created lazily on first use (browsers require a user gesture) and every call is
// wrapped in try/catch so a WebAudio quirk (or a browser that blocks it) can never break tagging.
import { S } from './state.js';

export function getAudioCtx(){
  try{
    if(!S.audioCtx){ var Ctx=window.AudioContext||window.webkitAudioContext; if(!Ctx) return null; S.audioCtx=new Ctx(); }
    if(S.audioCtx.state==='suspended' && S.audioCtx.resume) S.audioCtx.resume();
    return S.audioCtx;
  }catch(_){ return null; }
}
export function playTone(freq,durMs,type,vol){
  if(!S.soundOn) return;
  try{
    var ctx=getAudioCtx(); if(!ctx) return;
    var osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.type=type||'sine'; osc.frequency.value=freq;
    var v=vol==null?0.14:vol, now=ctx.currentTime, end=now+durMs/1000;
    gain.gain.setValueAtTime(v,now);
    gain.gain.exponentialRampToValueAtTime(0.0001,end);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(end+0.02);
  }catch(_){}
}
export function zoneBlipFreq(z){ var row=z&&z[0]; return row==='F'?880:440; } // front high, back low
export function playZoneBlip(z){ playTone(zoneBlipFreq(z),70,'triangle',0.12); }
export function playOutcomeBlip(){ playTone(950,90,'square',0.1); }
export function playRejectBlip(){ playTone(150,120,'sawtooth',0.08); }
