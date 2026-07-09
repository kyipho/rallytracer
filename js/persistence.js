// ---------- persistence ----------
import { S } from './state.js';

export function save(){ try{ localStorage.setItem('squashTagger.match',JSON.stringify(S.M)); }catch(_){} }
// isIncompatible: true for anything saved/exported under the old 9-zone (3x3) court, which schema 3
// can't represent — the row 'M' and col 'C' zone letters simply don't exist any more. Checked both
// by schema number (belt) and by scanning shot zone strings for a stray M/C (suspenders, in case a
// file was hand-edited or the schema tag is missing/wrong).
export function isIncompatible(m){
  if(!m || m.schema==null || m.schema<3) return true;
  var bad=false;
  (m.games||[]).forEach(function(g){ (g.rallies||[]).forEach(function(r){ (r.shots||[]).forEach(function(sh){
    var s=sh.start||sh.source, e=sh.end||sh.target;
    if((s&&(s.indexOf('M')>=0||s.indexOf('C')>=0)) || (e&&(e.indexOf('M')>=0||e.indexOf('C')>=0))) bad=true;
  });});});
  return bad;
}
export function migrate(m){
  if(!m||!m.games) return m;
  m.games.forEach(function(g){ g.rallies.forEach(function(r){ r.shots.forEach(function(sh){
    if('source' in sh){ sh.start=sh.source; delete sh.source; }
    if('target' in sh){ sh.end=sh.target; delete sh.target; }
    if(!('t' in sh)) sh.t=null;        // schema 2: per-shot video timestamp (seconds, or null)
    // legacy saves carry the old auto-guessed stroke-options field, and their sh.stroke was
    // auto-deduced (indistinguishable from a user pick). Wipe both so tallies only ever count
    // strokes the user explicitly tagged; 'serve' is structural and stays.
    if('candidates' in sh){
      if(sh.stroke!=='serve') sh.stroke=null;
      delete sh.candidates;
    }
  });});});
  // event types were renamed conduct_* -> award_* (awards cover injury/retirement too, not just
  // conduct); map old persisted names so legacy saves/exports keep working
  var EV_RENAME={conduct_point:'award_point', conduct_game:'award_game', conduct_match:'award_match'};
  (m.events||[]).forEach(function(ev){ if(EV_RENAME[ev.type]) ev.type=EV_RENAME[ev.type]; });
  if(m.bestOf==null) m.bestOf=5;        // schema 2: match length (best-of), default 5
  if(m.forcedOver==null) m.forcedOver=false; // schema 2: manual retirement flag, kept distinct from auto match-end
  m.schema=3;
  return m;
}
export function load(){
  try{
    var s=localStorage.getItem('squashTagger.match');
    if(!s) return null;
    var obj=JSON.parse(s);
    if(isIncompatible(obj)){
      try{ localStorage.setItem('squashTagger.match.v2backup', s); }catch(_){}
      alert('Previous match used the old 9-zone court — backed up in browser storage, starting fresh.');
      return null;
    }
    return migrate(obj);
  }catch(_){ return null; }
}
export function loadSeekLead(){ try{ var s=localStorage.getItem('squashTagger.seekLead'); var n=s==null?2:+s; return isNaN(n)?2:Math.max(0,Math.min(15,n)); }catch(_){ return 2; } }
export function saveSeekLead(){ try{ localStorage.setItem('squashTagger.seekLead',String(S.seekLead)); }catch(_){} }
export function loadSound(){ try{ var s=localStorage.getItem('squashTagger.sound'); return s==null?true:s==='1'; }catch(_){ return true; } }
export function saveSound(){ try{ localStorage.setItem('squashTagger.sound',S.soundOn?'1':'0'); }catch(_){} }
export function loadAutoResume(){ try{ var s=localStorage.getItem('squashTagger.autoResume'); return s==null?true:s==='1'; }catch(_){ return true; } }
export function saveAutoResume(){ try{ localStorage.setItem('squashTagger.autoResume',S.autoResume?'1':'0'); }catch(_){} }
export function loadTourSeen(){ try{ return localStorage.getItem('squashTagger.tourSeen')==='1'; }catch(_){ return true; } }
export function saveTourSeen(){ try{ localStorage.setItem('squashTagger.tourSeen','1'); }catch(_){} }

// cleanedMatch: strip the trailing pending shot (no target yet) so exports only ever contain complete
// shots. Grouped here with persistence (per module plan) though it feeds the export path.
export function cleanedMatch(){
  var copy=JSON.parse(JSON.stringify(S.M));
  var g=copy.games[copy.games.length-1];
  if(g){
    var r=g.rallies[g.rallies.length-1];
    if(r && r.outcome===null && r.shots.length){
      var last=r.shots[r.shots.length-1];
      if(last.end==null && last.outcome==='in_play') r.shots.pop();
    }
  }
  return copy;
}
