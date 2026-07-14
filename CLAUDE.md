# RallyTracer (squash-tagger)

Vanilla-JS web app for tagging shot-by-shot data in a squash match while watching a YouTube replay. No build step, no dependencies, no framework — ES modules loaded straight by the browser.

## Running

```
python3 -m http.server 8000   # from this directory
```

Open `http://localhost:8000/index.html`. A local server is required — YouTube's iframe API refuses to load under `file://` (the app shows a warning banner if you try).

There are no tests and no linter. Verify changes by loading the app in a browser; `node --check js/<file>.js` is the minimum bar for JS edits.

`pause-test.html` is a minimal standalone YouTube-player test page kept for debugging.

## Layout

- `index.html` — all static markup (court SVG shell, scoreboard, editor, analytics/match-controls panels).
- `css/styles.css` — the only stylesheet. Sections are marked with `/* ---------- name ---------- */` comments; append to the matching section.
- `js/` — one module per concern:
  - `main.js` — entry point (`<script type="module">`, deferred so the DOM is ready): registers the render callback, loads persisted state, assigns the global YouTube API callback, and wires every DOM listener / keyboard shortcut / event-delegation handler (e.g. `data-clear-g` tape actions) to the mutator modules, then boots with an initial render.
  - `state.js` — the shared mutable store `S` (`S.M` is the match model, the single source of truth) plus pure readers (`curGame`, `focusRally`, `nm`, …) and the `requestRender()` callback that breaks the mutator→render import cycle.
  - `model.js` — match/game/rally constructors, zone helpers, stroke vocabulary. Schema version lives on the match object (`schema:3`).
  - `court.js` — live court SVG zones + tap handling. Geometry constants: viewBox `0 0 300 360`, cols x=[6,150] w=144, rows y=[6,186] h=[180,168].
  - `outcomes.js` / `awards.js` / `edit.js` / `history.js` — rally outcomes, manual referee awards (event-logged), shot-row insert/delete, undo/redo (`z`/`y`).
  - `render.js` — full re-render from `S`; `analytics.js` — pure stats over the games array; `youtube.js` — the module-private live player; `persistence.js` — localStorage; `importexport.js` — JSON/CSV; `toast.js`, `audio.js`.
  - `tour.js` — self-contained first-run guided tour (own overlay DOM, own demo court SVG, own `YT.Player`, capture-phase key swallowing). It must never import mutators or touch `S.M`. `TOUR_CLIP` at the top holds the walkthrough clip config.
- `squash-tagger.html` — the **legacy single-file version**. Never edit it; it is kept as-is deliberately (a lint/format pass on it is deferred, not wanted in reviews).

## Invariants

- **localStorage keys are permanent.** Everything lives under `squashTagger.*` (`match`, `seekLead`, `sound`, `autoResume`, `tourSeen`). Never rename a key; users' saved matches depend on them. Pref loaders fail open with sensible defaults inside try/catch.
- **Tap = where the ball is struck**, not where it lands; the landing zone is filled by the *next* tap (or by the landing tap after a `w`/`u`/`f` outcome key). Zone codes are `FL`/`FR`/`BL`/`BR`.
- Keys: `w`/`u`/`f` = winner/unforced/forced (then a landing tap), `n`/`l`/`s` = no let/let/stroke (`n` and `s` open the who-gets-it popover), `z`/`y` = undo/redo.
- Mutating modules call `requestRender()` — never import `render.js` directly (import cycle).
- Session-only state (popover flags, action/redo stacks, analytics tab, tour state) must never be saved into `S.M` or exported.
- The tour's player and the live player are separate `YT.Player` instances; don't merge them or reach into `youtube.js`'s private player from the tour.

## Code style

Match the existing idiom exactly: `var` (no `let`/`const`), function declarations, 2-space indent, single-line bodies where the original uses them, terse `// ---------- section ----------` headers, comments only for non-obvious constraints. CSS uses the existing custom properties (`--amber`, `--panel2`, `--line2`, `--mono`, …) — no new hard-coded colors.

## Process notes

- The user prefers implementation work split across subagents when they ask for it, with disjoint file sets per agent (two agents must never edit the same file concurrently).
- Browser verification is frequently skipped at the user's request — when it is, say so plainly in the summary rather than implying the change was tested.
