// ---------- export / import ----------
import { S, requestRender } from './state.js';
import { freshMatch, newRally, newGame, direction } from './model.js';
import { cleanedMatch } from './persistence.js';
import { restoreFullM } from './history.js';
import { cueVideo } from './youtube.js';
import { toast } from './toast.js';

function download(name,text,type){
  var blob=new Blob([text],{type:type}); var u=URL.createObjectURL(blob);
  var a=document.createElement('a'); a.href=u; a.download=name; a.click(); setTimeout(function(){URL.revokeObjectURL(u);},500);
}
// count shots left incomplete (mid-rally, no end zone) so export can warn rather than silently
// emitting null rows. The live trailing pending shot is excluded (cleanedMatch strips it anyway).
function validateMatch(){
  var n=0;
  S.M.games.forEach(function(g){ g.rallies.forEach(function(r){ r.shots.forEach(function(sh,i){
    var isTerm = sh.outcome && sh.outcome!=='in_play';
    if(sh.end==null && !isTerm && i<r.shots.length-1) n++;
  });});});
  return n;
}
// matchToJson: compact-but-readable JSON — structure (match fields, games, rallies) keeps 2-space
// pretty-printing, but each shot and each event is one plain JSON.stringify line, so a game is
// ~200 lines instead of ~6k. Walks the known match shape explicitly (never regex-postprocesses
// pretty output); the result is ordinary valid JSON, so import needs no changes.
function matchToJson(c){
  function line(v){ return JSON.stringify(v); }
  function list(items,ind,fmt){
    if(!items || !items.length) return '[]';
    return '[\n'+items.map(function(it){ return ind+'  '+fmt(it,ind+'  '); }).join(',\n')+'\n'+ind+']';
  }
  function obj(o,ind,special){
    var keys=Object.keys(o);
    if(!keys.length) return '{}';
    return '{\n'+keys.map(function(k){
      var sp=special&&special[k];
      return ind+'  '+JSON.stringify(k)+': '+(sp?sp(o[k],ind+'  '):line(o[k]));
    }).join(',\n')+'\n'+ind+'}';
  }
  function rally(r,ind){ return obj(r,ind,{shots:function(v,ind2){ return list(v,ind2,function(sh){ return line(sh); }); }}); }
  function game(g,ind){ return obj(g,ind,{rallies:function(v,ind2){ return list(v,ind2,rally); }}); }
  return obj(c,'',{
    games:function(v,ind){ return list(v,ind,game); },
    events:function(v,ind){ return list(v,ind,function(ev){ return line(ev); }); }
  });
}
export function exportJson(){
  var bad=validateMatch(); if(bad>0 && !confirm(bad+' shot(s) are missing end zones. Export anyway?')) return;
  var c=cleanedMatch(); download(c.id+'.json',matchToJson(c),'application/json');
}
// CSV v2 (csv_schema=3): round-trippable. Three row kinds share one 18-column header, keyed by
// event_type: 'meta' (key=value match fields), 'game' (recorded per-game score summary — import
// trusts these instead of replaying scoring, since awarded points and awarded games make pure
// replay ambiguous), plus the shot rows and logged-event rows as before (ev.player now rides in
// its own event_player column, ev.detail stays raw). Fidelity limits, same as JSON export: event
// order within a game isn't recorded (only gameNo), and the live pending shot is stripped by
// cleanedMatch() — a rally left with no shots by that strip comes back as a fresh open rally.
function matchToCsv(c){
  var rows=[['match_id','player_a','player_b','game','rally','shot_idx','striker','stroke','direction','contact','start_zone','end_zone','video_time','outcome','point_winner','event_type','event_detail','event_player']];
  function meta(k,v){ rows.push([c.id,c.playerA,c.playerB,'','','','','','','','','','','','','meta',k+'='+(v==null?'':v),'']); }
  meta('csv_schema',3); meta('videoId',c.videoId); meta('bestOf',c.bestOf); meta('server',c.server);
  meta('createdAt',c.createdAt); meta('forcedOver',c.forcedOver?1:0); meta('matchWinner',c.matchWinner);
  c.games.forEach(function(g){
    rows.push([c.id,c.playerA,c.playerB,g.no,'','','','','','','','','','','','game','A='+g.A+';B='+g.B+';done='+(g.done?1:0)+';winner='+(g.winner||''),'']);
  });
  c.games.forEach(function(g){ g.rallies.forEach(function(r){ r.shots.forEach(function(sh){
    rows.push([c.id,c.playerA,c.playerB,g.no,r.no,sh.idx,sh.striker,sh.stroke||'',sh.direction||'',sh.contact,sh.start||'',sh.end||'',sh.t==null?'':sh.t,sh.outcome,r.pointWinner||'','','','']);
  });});});
  (c.events||[]).forEach(function(ev){
    rows.push([c.id,c.playerA,c.playerB,ev.gameNo,'','','','','','','','','','','',ev.type,ev.detail,ev.player||'']);
  });
  return rows.map(function(r){ return r.map(function(v){ var s=String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(','); }).join('\n');
}
export function exportCsv(){
  var bad=validateMatch(); if(bad>0 && !confirm(bad+' shot(s) are missing end zones. Export anyway?')) return;
  var c=cleanedMatch();
  download(c.id+'.csv',matchToCsv(c),'text/csv');
}

// parseCsv: minimal correct CSV parser — quoted fields, "" escapes, newlines inside quotes.
export function parseCsv(text){
  var rows=[], row=[], field='', i=0, inQ=false, ch;
  while(i<text.length){
    ch=text[i];
    if(inQ){
      if(ch==='"'){ if(text[i+1]==='"'){ field+='"'; i+=2; continue; } inQ=false; i++; continue; }
      field+=ch; i++; continue;
    }
    if(ch==='"'){ inQ=true; i++; continue; }
    if(ch===','){ row.push(field); field=''; i++; continue; }
    if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&text[i+1]==='\n') i++;
      row.push(field); field=''; rows.push(row); row=[]; i++; continue;
    }
    field+=ch; i++;
  }
  if(field!==''||row.length){ row.push(field); rows.push(row); }
  return rows;
}
// matchFromCsv: rebuild a schema-3 match from parseCsv rows of a v2 export (see matchToCsv).
// Returns null (after toasting why) if the header isn't the importable v2 format. Game scores/
// winners are trusted from the recorded 'game' rows; direction re-derives from direction() exactly
// like migrate(), so the CSV's direction column is ignored on import. sh.stroke is imported as-is.
export function matchFromCsv(rows){
  var header=rows[0]||[];
  if(header.indexOf('event_player')<0){
    toast("Old CSV exports weren't importable — only the current format (with an event_player column) is. Re-export the match.");
    return null;
  }
  var col={}; header.forEach(function(h,i){ col[h]=i; });
  var m=freshMatch();
  m.games=[]; m.videoId=null;
  var gamesByNo={}, ralliesByKey={};
  function getGame(no){
    if(!gamesByNo[no]){ gamesByNo[no]={no:no, rallies:[], A:0, B:0, done:false, winner:null}; m.games.push(gamesByNo[no]); }
    return gamesByNo[no];
  }
  rows.slice(1).forEach(function(row){
    if(!row.length || (row.length===1 && row[0]==='')) return; // stray blank line
    function f(name){ var i=col[name]; return (i==null||row[i]==null)?'':row[i]; }
    m.id=f('match_id')||m.id; m.playerA=f('player_a')||m.playerA; m.playerB=f('player_b')||m.playerB;
    var et=f('event_type');
    if(et==='meta'){
      var d=f('event_detail'), eq=d.indexOf('='), k=d.slice(0,eq), v=d.slice(eq+1);
      if(k==='videoId') m.videoId=v||null;
      else if(k==='bestOf') m.bestOf=+v||5;
      else if(k==='server') m.server=v||'A';
      else if(k==='createdAt') m.createdAt=v||m.createdAt;
      else if(k==='forcedOver') m.forcedOver=v==='1';
      else if(k==='matchWinner') m.matchWinner=v||null;
      return;
    }
    if(et==='game'){
      var g=getGame(+f('game'));
      f('event_detail').split(';').forEach(function(pair){
        var i2=pair.indexOf('='), k2=pair.slice(0,i2), v2=pair.slice(i2+1);
        if(k2==='A') g.A=+v2||0; else if(k2==='B') g.B=+v2||0;
        else if(k2==='done') g.done=v2==='1'; else if(k2==='winner') g.winner=v2||null;
      });
      return;
    }
    if(et){ // a logged event row (award/reset/…) — same shape logEvent() builds
      m.events.push({id:++S.evSeq, type:et, player:f('event_player')||null, gameNo:+f('game'), detail:f('event_detail')||''});
      return;
    }
    // shot row — grouped in file order by (game, rally)
    var g2=getGame(+f('game')), key=f('game')+':'+f('rally'), r=ralliesByKey[key];
    if(!r){ r=newRally(+f('rally'),null); ralliesByKey[key]=r; g2.rallies.push(r); }
    var sh={ idx:+f('shot_idx'), striker:f('striker'), stroke:f('stroke')||null,
      direction:null, contact:f('contact'), start:f('start_zone')||null, end:f('end_zone')||null,
      outcome:f('outcome')||'in_play', t:f('video_time')===''?null:parseFloat(f('video_time')) };
    if(sh.start!=null && sh.end!=null){
      sh.direction=sh.idx===0?null:direction(sh.start,sh.end);
    }
    if(sh.idx===0) r.server=sh.striker;
    if(f('point_winner')) r.pointWinner=f('point_winner');
    r.shots.push(sh);
  });
  m.games.sort(function(a,b){ return a.no-b.no; });
  m.games.forEach(function(g){
    g.rallies.forEach(function(r){
      if(r.server==null) r.server = r.shots.length ? r.shots[0].striker : m.server;
      var last=r.shots[r.shots.length-1];
      r.outcome = (last && last.outcome && last.outcome!=='in_play') ? last.outcome : null;
    });
    if(!g.rallies.length) g.rallies.push(newRally(1,m.server));
  });
  if(!m.games.length) m.games.push(newGame(1,m.server));
  m.gamesWon={A:0,B:0};
  m.games.forEach(function(g){ if(g.done && g.winner) m.gamesWon[g.winner]+=1; });
  var needed=Math.ceil((m.bestOf||5)/2);
  m.matchOver = m.gamesWon.A>=needed || m.gamesWon.B>=needed || m.forcedOver;
  return m;
}
// applyImportedMatch: shared tail of both import paths (JSON and CSV) — confirm, swap M, reset
// all session state, re-cue the video, re-render.
export function applyImportedMatch(obj){
  if(!confirm('Replace the current match with the imported one?')) return;
  restoreFullM(JSON.stringify(obj));
  S.selectedShot=null; S.viewGameIdx=null; S.expandedRally=null; S.actionStack=[]; S.redoStack=[];
  S.awaitingTarget=false; S.armZone=null;
  if(S.M.videoId) cueVideo(S.M.videoId);
  requestRender(); toast('Match imported');
}

// each import pill picks its own format: it sets the mode + the file input's accept filter, then
// opens the shared hidden input. The change handler (in main.js) parses strictly per currentImportMode().
var importMode='json'; // 'json' | 'csv' — which import pill opened the file picker
export function openImportPicker(mode,accept){
  importMode=mode;
  var inp=document.getElementById('importFile');
  inp.setAttribute('accept',accept);
  inp.click();
}
export function currentImportMode(){ return importMode; }
