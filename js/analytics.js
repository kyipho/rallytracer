// ---------- live analytics ----------
import { S, nm, viewedGame } from './state.js';
import { other, ALL_STROKES, ZROWS, ZCOLS } from './model.js';
import { COLX, ROWY, CW, ROWH } from './court.js';

// usableShot: excludes the live trailing pending shot of an open rally, and any incomplete
// mid-rally shot left without an end zone — the same rule validateMatch()/shotRowHtml() use.
// Terminal shots of 'stroke'/'let' rallies (end intentionally nulled) are NOT excluded.
function usableShot(sh){
  var isTerm = sh.outcome && sh.outcome!=='in_play';
  return isTerm || sh.end!=null;
}
var ANA_ZONES=['FL','FR','BL','BR'];
// computeStats: single pass over shots/rallies for tallies + court + rally stats, plus a second
// pass for shot-sequence patterns. Pure function of the games array passed in — no caching.
function computeStats(scopeGames){
  function mkPlayer(){
    return {
      winners:0, ue:0, fe:0, strokePts:0,
      pointsWon:0, ptsServing:0, ptsServingWon:0, ptsReturning:0, ptsReturningWon:0,
      curStreak:0, longStreak:0,
      strokeCounts:{drive:0,drop:0,boast:0,backwall:0,lob:0,kill:0},
      nonServeShots:0, volleyShots:0
    };
  }
  function mkCourt(){
    var c={struck:{},lands:{},winLands:{},errFrom:{}};
    ANA_ZONES.forEach(function(z){ c.struck[z]=0; c.lands[z]=0; c.winLands[z]=0; c.errFrom[z]=0; });
    return c;
  }
  var st={A:mkPlayer(),B:mkPlayer()};
  var court={A:mkCourt(),B:mkCourt()};
  var rallyStats={total:0, lenSum:0, lets:0, noLets:0, strokes:0,
    buckets:{short:{A:0,B:0},mid:{A:0,B:0},long:{A:0,B:0}},
    serve:{A:{tot:0,won:0},B:{tot:0,won:0}},
    momentum:[]};
  var running={A:0,B:0};

  (scopeGames||[]).forEach(function(g){
    g.rallies.forEach(function(r){
      var usable=r.shots.filter(usableShot);
      usable.forEach(function(sh){
        var p=st[sh.striker], c=court[sh.striker];
        if(sh.stroke && sh.stroke!=='serve'){
          p.nonServeShots++;
          if(p.strokeCounts.hasOwnProperty(sh.stroke)) p.strokeCounts[sh.stroke]++;
          if(sh.contact==='volley'||sh.contact==='half-volley') p.volleyShots++;
        }
        if(sh.start && c.struck.hasOwnProperty(sh.start)) c.struck[sh.start]++;
        if(sh.end && c.lands.hasOwnProperty(sh.end)) c.lands[sh.end]++;
      });

      if(r.outcome===null) return; // open rally: no point/outcome/rally-length data yet

      if(r.outcome==='let'){
        rallyStats.lets++;
        return; // lets don't score — they never appear in the points-won strip
      }

      var pw=r.pointWinner;
      var term=usable.length ? usable[usable.length-1] : null;
      if(term){
        if(r.outcome==='winner'){
          st[term.striker].winners++;
          if(term.end) court[term.striker].winLands[term.end]++;
        } else if(r.outcome==='unforced_error'){
          st[term.striker].ue++;
          if(term.start) court[term.striker].errFrom[term.start]++;
        } else if(r.outcome==='forced_error'){
          st[term.striker].fe++;
          if(term.start) court[term.striker].errFrom[term.start]++;
        } else if(r.outcome==='stroke' && pw){
          st[pw].strokePts++;
          rallyStats.strokes++;
        } else if(r.outcome==='no_let'){
          rallyStats.noLets++;
        }
      }
      if(!pw) return; // stroke outcome with no recorded winner (shouldn't normally happen)

      st[pw].pointsWon++;
      var server=r.server, returner=other(server);
      st[server].ptsServing++; st[returner].ptsReturning++;
      if(pw===server) st[server].ptsServingWon++; else st[returner].ptsReturningWon++;

      var len=r.shots.length;
      rallyStats.total++; rallyStats.lenSum+=len;
      var bucket = len<=4?'short':(len<=10?'mid':'long');
      rallyStats.buckets[bucket][pw]++;
      rallyStats.serve[server].tot++;
      if(pw===server) rallyStats.serve[server].won++;

      running[pw]++; running[other(pw)]=0;
      if(running[pw]>st[pw].longStreak) st[pw].longStreak=running[pw];

      rallyStats.momentum.push({p:pw});
    });
  });
  // current streak derives from the running counters AFTER the loop — only the streak that is
  // actually alive at the end of the scope is "current"; the other player's is 0 by definition
  st.A.curStreak=running.A; st.B.curStreak=running.B;
  rallyStats.avgLen = rallyStats.total ? (rallyStats.lenSum/rallyStats.total) : 0;

  // second pass: shot-sequence patterns (last up-to-3 shots of each decided, non-let rally)
  function bump(obj,key){ obj[key]=(obj[key]||0)+1; }
  var patterns={A:{win2:{},win3:{},err2:{},err3:{},setup:{}}, B:{win2:{},win3:{},err2:{},err3:{},setup:{}}};
  (scopeGames||[]).forEach(function(g){
    g.rallies.forEach(function(r){
      if(r.outcome===null || r.outcome==='let' || r.outcome==='no_let' || !r.pointWinner) return;
      var usable=r.shots.filter(usableShot);
      if(!usable.length) return;
      var last=usable[usable.length-1];
      var actor=last.striker; // winner striker == pw; error striker == other(pw)
      var tokens=[];
      usable.slice(Math.max(0,usable.length-3)).forEach(function(sh){
        if(sh.start) tokens.push(sh.striker+':'+sh.start+'>'+(sh.end||''));
      });
      var isWinner = r.outcome==='winner';
      var isErr = r.outcome==='unforced_error' || r.outcome==='forced_error';
      if(tokens.length>=2){
        var g2=tokens.slice(-2).join('→');
        if(isWinner) bump(patterns[actor].win2,g2); else if(isErr) bump(patterns[actor].err2,g2);
      }
      if(tokens.length>=3){
        var g3=tokens.slice(-3).join('→');
        if(isWinner) bump(patterns[actor].win3,g3); else if(isErr) bump(patterns[actor].err3,g3);
      }
      if(isWinner && usable.length>=2){
        var prev=usable[usable.length-2];
        if(prev.striker!==actor && prev.start) bump(patterns[actor].setup, prev.start+'>'+(prev.end||''));
      }
    });
  });

  return {players:st, court:court, rallyStats:rallyStats, patterns:patterns};
}

function anaScopedGames(){
  if(S.analyticsScope==='game'){ var vg=viewedGame(); return vg ? [vg] : []; }
  return S.M.games;
}
function anaTile(lab,val,cls){
  return '<div class="anaTile"><div class="lab">'+lab+'</div><div class="val'+(cls?' '+cls:'')+'">'+val+'</div></div>';
}
function anaPct(num,den){ return den ? (num+'/'+den+' ('+Math.round(100*num/den)+'%)') : '–'; }

function renderTalliesHtml(stats){
  var html='';
  var playerHtml='';
  ['A','B'].forEach(function(p){
    var s=stats.players[p];
    var volleyRate = s.nonServeShots ? Math.round(100*s.volleyShots/s.nonServeShots)+'%' : '–';
    var strokeStr = ALL_STROKES.map(function(k){ return k+' '+s.strokeCounts[k]; }).join(' · ');
    playerHtml+='<div class="anaSection"><h4>'+nm(p)+'</h4><div class="anaStats">'
      +anaTile('Winners', s.winners, p==='A'?'a':'b')
      +anaTile('Unforced errors', s.ue)
      +anaTile('Forced errors', s.fe)
      +anaTile('W − UE', s.winners-s.ue)
      +anaTile('Stroke points', s.strokePts)
      +anaTile('Points won', s.pointsWon)
      +anaTile('Serving', anaPct(s.ptsServingWon,s.ptsServing))
      +anaTile('Returning', anaPct(s.ptsReturningWon,s.ptsReturning))
      +anaTile('Current streak', s.curStreak)
      +anaTile('Longest streak', s.longStreak)
      +anaTile('Volley rate', volleyRate)
      +'</div><div class="anaSeqList" style="margin-top:8px">tagged strokes: '+strokeStr+'</div></div>';
  });
  html+='<div class="anaPlayers">'+playerHtml+'</div>';
  var rs=stats.rallyStats;
  html+='<div class="anaSection"><h4>Decisions</h4><div class="anaStats">'
    +anaTile('Total', rs.lets+rs.strokes+rs.noLets)
    +anaTile('Lets', rs.lets)
    +anaTile('Strokes', rs.strokes)
    +anaTile('No lets', rs.noLets)
    +'</div></div>';
  return html;
}

function anaMiniCourtSvg(counts){
  var max=0; ANA_ZONES.forEach(function(z){ if(counts[z]>max) max=counts[z]; });
  var s='<svg class="anaCourt" viewBox="0 0 300 360">';
  s+='<rect x="6" y="6" width="288" height="348" rx="4" fill="var(--maple)"/>';
  s+='<line x1="6" y1="186" x2="294" y2="186" stroke="var(--maple-line)" stroke-width="2.5"/>';
  s+='<line x1="150" y1="186" x2="150" y2="354" stroke="var(--maple-line)" stroke-width="2.5"/>';
  ZROWS.forEach(function(rw,ri){ ZCOLS.forEach(function(cl,ci){
    var z=rw+cl, x=COLX[ci], y=ROWY[ri], ch=ROWH[ri];
    var c=counts[z]||0;
    var alpha = max ? (0.10+0.55*(c/max)) : 0.10;
    s+='<rect x="'+(x+1.5)+'" y="'+(y+1.5)+'" width="'+(CW-3)+'" height="'+(ch-3)+'" rx="3" fill="rgba(242,169,59,'+alpha.toFixed(2)+')"/>';
    s+='<text x="'+(x+CW/2)+'" y="'+(y+ch/2+4)+'">'+c+'</text>';
  });});
  s+='</svg>';
  return s;
}
var ANA_METRIC_LABEL={struck:'Struck from',lands:'Lands in',winLands:'Winners land in',errFrom:'Errors from'};
function renderCourtHtml(stats){
  var metric=S.analyticsCourtMetric;
  var html='<div class="anaMetricRow">'+Object.keys(ANA_METRIC_LABEL).map(function(m){
    return '<button class="gpill'+(m===metric?' on':'')+'" data-ametric="'+m+'">'+ANA_METRIC_LABEL[m]+'</button>';
  }).join('')+'</div><div class="anaCourts">';
  ['A','B'].forEach(function(p){
    html+='<div class="anaCourtCol"><span class="cnm">'+nm(p)+'</span>'+anaMiniCourtSvg(stats.court[p][metric])+'</div>';
  });
  html+='</div>';
  return html;
}

function renderRalliesHtml(stats){
  var rs=stats.rallyStats;
  var html='<div class="anaStats">'
    +anaTile('Rallies', rs.total)
    +anaTile('Avg length', rs.avgLen ? rs.avgLen.toFixed(1) : '–')
    +anaTile('Decisions', rs.lets+rs.strokes+rs.noLets)
    +'</div>';
  html+='<div class="anaSection"><h4>Rally length — points won</h4><div class="anaBuckets">';
  [['short','≤4'],['mid','5–10'],['long','11+']].forEach(function(pair){
    var b=rs.buckets[pair[0]];
    html+='<div class="anaTile"><div class="lab">'+pair[1]+' shots</div><div class="val">'+nm('A')+' '+b.A+' · '+nm('B')+' '+b.B+'</div></div>';
  });
  html+='</div></div>';
  html+='<div class="anaSection"><h4>Serve win rate</h4><div class="anaStats">';
  ['A','B'].forEach(function(p){
    html+=anaTile(nm(p)+' serving', anaPct(rs.serve[p].won, rs.serve[p].tot));
  });
  html+='</div></div>';
  html+='<div class="anaSection"><h4>Points won</h4><div class="anaMomentum">'
    +rs.momentum.map(function(m,i){
      var bg = m.p==='A'?'var(--amber)':'var(--red)';
      return '<div class="pt"><i>'+(i+1)+'</i><span style="background:'+bg+'"></span></div>';
    }).join('')
    +(rs.momentum.length?'':'<span class="anaEmpty">no points yet</span>')
    +'</div><div class="anaSeqList" style="margin-top:6px;font-size:11px">'
    +'<span style="color:var(--amber)">■</span> '+nm('A')+'  '
    +'<span style="color:var(--red)">■</span> '+nm('B')
    +'</div></div>';
  return html;
}

function anaFmtZonePath(zp){
  var p=zp.split('>');
  return p[0]+(p[1]?'→'+p[1]:'');
}
function anaFmtSeq(key){
  return key.split('→').map(function(tok){
    var ci=tok.indexOf(':'); // striker:start>end
    var striker=tok.slice(0,ci), zones=tok.slice(ci+1);
    return striker+' '+anaFmtZonePath(zones);
  }).join(' → ');
}
function anaTopEntries(obj,n){
  return Object.keys(obj).map(function(k){ return [k,obj[k]]; })
    .filter(function(e){ return e[1]>=2; })
    .sort(function(a,b){ return b[1]-a[1]; }).slice(0,n);
}
function renderPatternsHtml(stats){
  var html='<div class="anaPlayers">';
  ['A','B'].forEach(function(p){
    var pat=stats.patterns[p];
    var win=anaTopEntries(pat.win2,5).concat(anaTopEntries(pat.win3,5))
      .sort(function(a,b){return b[1]-a[1];}).slice(0,5);
    var err=anaTopEntries(pat.err2,5).concat(anaTopEntries(pat.err3,5))
      .sort(function(a,b){return b[1]-a[1];}).slice(0,5);
    var setup=Object.keys(pat.setup).map(function(k){return [k,pat.setup[k]];})
      .sort(function(a,b){return b[1]-a[1];}).slice(0,3);
    var colHtml='';
    colHtml+='<div class="anaSection"><h4>'+nm(p)+' — winning sequences</h4><div class="anaSeqList">'
      +(win.length ? win.map(function(e){ return anaFmtSeq(e[0])+' <span class="cnt">×'+e[1]+'</span>'; }).join('<br>') : '<span class="anaEmpty">not enough data</span>')
      +'</div></div>';
    colHtml+='<div class="anaSection"><h4>'+nm(p)+' — error sequences</h4><div class="anaSeqList">'
      +(err.length ? err.map(function(e){ return anaFmtSeq(e[0])+' <span class="cnt">×'+e[1]+'</span>'; }).join('<br>') : '<span class="anaEmpty">not enough data</span>')
      +'</div></div>';
    colHtml+='<div class="anaSection"><h4>'+nm(p)+' — setup shots before winners</h4><div class="anaSeqList">'
      +(setup.length ? setup.map(function(e){ return anaFmtZonePath(e[0])+' <span class="cnt">×'+e[1]+'</span>'; }).join('<br>') : '<span class="anaEmpty">not enough data</span>')
      +'</div></div>';
    html+='<div class="anaCol">'+colHtml+'</div>';
  });
  html+='</div>';
  return html;
}

export function renderAnalytics(){
  var body=document.getElementById('anaBody');
  var stats=computeStats(anaScopedGames());
  if(S.analyticsTab==='tallies') body.innerHTML=renderTalliesHtml(stats);
  else if(S.analyticsTab==='court') body.innerHTML=renderCourtHtml(stats);
  else if(S.analyticsTab==='rallies') body.innerHTML=renderRalliesHtml(stats);
  else body.innerHTML=renderPatternsHtml(stats);
}
