# RallyTracer

**Tag squash matches shot-by-shot while you watch the YouTube replay.**

RallyTracer turns a match video into structured shot data — every shot, its court zone, and how each rally ended — then gives you live analytics as you go. It runs entirely in your browser: no accounts, no build step, no server. Your match autosaves to `localStorage` and never leaves your machine.

The option to use YouTube replays is provided for convenience, but you can easily watch any non-Youtube videos separately instead, and use only the tagging functionality on the app.

**▶ [Open the app](https://kyipho.github.io/rallytracer/)** · works best on desktop in a full browser

## What it does

- **Watch & tag together** — the video plays beside a squash court diagram. Tap the court where each shot is struck; the *next* tap fills in where the ball landed.
- **One-key outcomes** — `w`/`u`/`f` mark a winner / unforced error / forced error, then a landing tap. `n`/`l`/`s` handle no-let / let / stroke decisions.
- **Full scoreboard logic** — PAR scoring, server tracking, best-of-3/5, plus manual referee awards (conduct, injury, retirement) for points, games, or the match.
- **Live analytics** — tallies, a court heatmap, rally lengths, and shot patterns, scoped to the current game or the whole match.
- **Undo/redo** everything (`z`/`y`), and edit any shot row after the fact.
- **Import/export** as JSON (round-trips the full match) or CSV (for spreadsheets).
- **Guided tour** on first run walks you through tagging your first rally.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| tap court | Where the shot is struck (next tap = where it lands) |
| `w` / `u` / `f` | Winner / unforced error / forced error (then tap the landing zone) |
| `n` / `l` / `s` | No let / let / stroke |
| `z` / `y` | Undo / redo |

## Running locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/index.html>.

## Tech

Vanilla JavaScript ES modules loaded straight by the browser. `index.html` holds the markup, `css/styles.css` the styling, and `js/` one module per concern (state, model, court, analytics, persistence, …). The single source of truth is one match object persisted to `localStorage`.

## License

[MIT](LICENSE) © kyipho
