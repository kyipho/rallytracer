// ---------- state store ----------
// The single mutable state object shared across every module. It holds M (the match model, the
// single source of truth) plus every session-only UI/history/settings/analytics flag that used to
// live as a closure var in the original single-file IIFE. Mutating modules import S and mutate
// S.M... ; nobody re-declares state. Persisted fields (M, seekLead, soundOn, autoResume)
// are initialised at boot by main.js (via persistence loaders) — see the null/default placeholders.
import { other } from './model.js';

export var S = {
  M: null,                     // the match model — set by main.js at boot: load() || freshMatch()
  armZone: null,               // null | 'start' | 'end'  (which field a court tap edits on the edited shot)
  awaitingTarget: false,       // true right after winner/error is clicked: next tap fills the ender's landing zone
  // strokePopoverOpen: true while the "stroke — point to:" popover is shown (session-only, never saved
  // or mutated into M — picking a player or cancelling just hides it again).
  strokePopoverOpen: false,
  // decisionOutcome: which outcome the open popover is resolving ('stroke' | 'no_let') — session-only,
  // never saved or mutated into M, same as strokePopoverOpen.
  decisionOutcome: 'stroke',
  selectedShot: null,          // {shot, gameNo, rallyNo, idx} | null — a shot picked by clicking a tape row
  viewGameIdx: null,           // null = tape always follows the live game; a number pins it to a past game
  expandedRally: null,         // {g, r} | null — which collapsed history rally (if any) is expanded open
  // actionStack: in-session ONLY (never saved into M, never exported). Each entry is either the marker
  // string 'shot' (a shot-domain action, reversed by the existing state-based shot-undo) or an
  // event-undo record {event, snap, rallies?, eventsSnap?} for a manual award/reset action.
  actionStack: [],
  // redoStack: full-state snapshots pushed by undo(), popped by redo(). Cleared on any new action.
  redoStack: [],
  evSeq: 0,                    // monotonic id for events, so undo-after-redo can find them by id not by reference
  // seekLead: how many seconds BEFORE a tagged shot's timestamp we seek when reviewing it. Because
  // tagging always lags the real strike, leading the seek lands you just before the action. Stored
  // under its own key so it's a per-browser preference, not match data. (set at boot from loadSeekLead)
  seekLead: 2,
  soundOn: true,               // set at boot from loadSound()
  autoResume: true,            // set at boot from loadAutoResume()
  audioCtx: null,
  // live analytics: session-only UI state (never saved) — which tab/scope/court-metric is showing
  analyticsTab: 'tallies',       // 'tallies' | 'court' | 'rallies' | 'patterns'
  analyticsScope: 'match',       // 'match' | 'game' (game = viewedGame())
  analyticsCourtMetric: 'struck' // 'struck' | 'lands' | 'winLands' | 'errFrom'
};

// ---------- helpers on state ----------
export function curGame(){ return S.M.games[S.M.games.length-1]; }
export function curRally(){ var g=curGame(); return g.rallies[g.rallies.length-1]; }
export function strikerFor(rally,idx){ return idx%2===0 ? rally.server : other(rally.server); }
export function rallyOpen(r){ return r.outcome===null; }

// ---------- viewing past games (read-only browsing; never affects live tagging) ----------
export function liveGameIdx(){ return S.M.games.length-1; }
export function viewIdx(){ return S.viewGameIdx==null ? liveGameIdx() : Math.min(S.viewGameIdx, liveGameIdx()); }
export function viewedGame(){ return S.M.games[viewIdx()]; }
export function isViewingLive(){ return viewIdx()===liveGameIdx(); }

// focusRally = the rally currently in view (last rally; may be open or just-closed). A pure S.M
// reader used by outcomes/history/edit/court/render — kept here to keep the dependency graph acyclic.
export function focusRally(){ var g=curGame(); return g.rallies[g.rallies.length-1]; }

// nm = a player's display name — a pure S.M reader used by render/analytics/awards; here for the same
// acyclicity reason as focusRally.
export function nm(p){ return p==='A'?S.M.playerA:S.M.playerB; }

// clearRedo wipes the redo stack (a trivial state mutation) — called by every new-action mutator
// (court/outcomes/awards/edit). Kept in the store so those modules need not import history.js.
export function clearRedo(){ S.redoStack=[]; }

// ---------- render decoupling ----------
// requestRender() triggers a re-render via a callback registered at boot (setRenderCallback). Mutating
// modules call requestRender() instead of importing render.js — this breaks the import cycle between
// state-mutators and the render module. main.js does setRenderCallback(renderAll).
var _renderCb = null;
export function setRenderCallback(fn){ _renderCb = fn; }
export function requestRender(){ if(_renderCb) _renderCb(); }
