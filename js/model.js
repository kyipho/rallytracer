// ---------- model ----------
export var ZROWS = ['F','B'], ZCOLS=['L','R'];
export function other(p){ return p==='A'?'B':'A'; }
export function colRow(z){ return [ {L:0,R:1}[z[1]], {F:0,B:1}[z[0]] ]; }
export function direction(src,tgt){ if(!src) return null; return colRow(src)[0]===colRow(tgt)[0] ? 'straight':'cross'; }

// Full stroke vocabulary (serve handled separately, fixed on idx 0). Strokes are tagged manually
// by the user (optional) — never inferred from zone geometry.
export var ALL_STROKES = ['drive','drop','boast','backwall','lob','kill'];

export function newRally(no,server){ return {no:no, server:server, shots:[], outcome:null, pointWinner:null}; }
export function newGame(no,server){ return {no:no, rallies:[newRally(1,server)], A:0, B:0, done:false, winner:null}; }
export function freshMatch(){
  return { schema:3, id:'m'+Date.now(), playerA:'Player A', playerB:'Player B', videoId:null,
           server:'A', createdAt:new Date().toISOString(), gamesWon:{A:0,B:0}, games:[newGame(1,'A')],
           events:[], bestOf:5, matchOver:false, forcedOver:false, matchWinner:null };
}
