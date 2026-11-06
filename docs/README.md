# Chess Masters PoC: how it fits together

## Playing
Double-click `PLAY CHESS MASTERS.bat` in the root folder. It checks for Node.js, installs packages on the first run, rebuilds if anything changed, starts a local server on port 4173 and opens the browser. Keep its window open while playing.

## Developing
```
npm install
npm run dev        # http://localhost:5173 (hot reload)
npm test           # unit tests (Vitest)
npm run build      # production build into dist/
npm run assets     # re-process Meshy pieces into public/assets/pieces + pieces.json
```
Smoke tests (need a running server): `node tools/smoke.mjs --game legal|scholar|king|promo --duel full|short|off [--skip] [--drag] [--challenge speed-win] [--video]`, `node tools/menu-flow.mjs`, `node tools/screenshots.mjs`.

### Teaching features
- **Hint** (left side, 3 per game): a glowing animated arrow, the piece bounces, a "TRY THIS!" burst and a card saying what to move and why (src/game/guide.ts, src/game/tactics.ts).
- **Guide** (left side, or the Help row on the New Game screen): the coach names the opening being played (real names, src/game/openings.ts), warns about pieces in danger, check and mate threats (red squares and "LOOK OUT!") and suggests a move with a reason every turn. Hints become unlimited.
- **Well done! badges**, always on: Fork, Royal Fork, Pin, Skewer, Discovered Attack/Check, Double Check, Castling, En Passant, Promotion, Fianchetto, Centre Control, All Developed, named openings (3+ moves), and named mates (Scholar's, Fool's, Smothered, Back-Rank).
- **Pop-up words** on captures (POW!, BAM!... / OUCH!, OH NO!...), CHECK!, CHECKMATE!, CASTLE!, PROMOTED!.
- **Invalid moves** shake the piece, buzz, and show a reason (e.g. "That would leave your King in check!", src/game/invalid.ts).
- **Sounds:** cheer when you take a piece, clang and sad wah-wah when you lose one; upbeat in-game music.

### Characters and animations
- `npm run assets` builds all 12 Meshy characters (tools/build-assets.mjs): picks each folder's GLB, **repairs the knights' incomplete leg rigs** (Light knight: back-right leg; Dark knight: both front legs; new bones + re-weighted skin, tools/rig.mjs), gives the custom rook and knight rigs standard bone names, and **retargets** clips between characters (tools/retarget.mjs) so every piece has every role it needs. It also generates `Idle_Simple`, a plain standing idle.
- Who plays what is data: `public/data/animations.json` (idle, walk and pace, attacks, capture celebration, defeat, game-start, team win, team lose; plus piece heights and the rook's width). Lists are per piece: pawns use their file (a-h), other pieces queen's side / king's side, so no two match. Recast a moment by editing a clip name and re-running `npm run assets`.
- Game start: Light pawns cheer, Dark pawns taunt (each its own clip, delay and pace). Game end: the winners dance/flip/breakdance (knights rear up), the losers fall over, stomp or wag a finger, the losing king bows with a white flag.
- Bishops (and the Dark Queen) attack with spells from range and throw a fireball (ruby-gold for Light, amethyst for Dark). Knights are centaurs: clips drive the rider, the horse legs gallop procedurally.
- Dark pieces are brightened at load with a soft purple rim light. In a game the canvas fills the window and zooms in on the board.

### Arenas
Five playable arenas: Palace Gardens, Dark Kingdom, Frozen Kingdom, Jungle Temple, Arabian Palace.
- `tools/arenas.json` lists each painting and how to find its board; `tools\.venv\Scripts\python tools/build_arena.py <id|all>` measures the painted board, solves the matched camera and cuts the plates into `public/assets/scene/`.
- `public/data/arenas.json` is each arena's look: 3D marble colours, weather on the board (snow, sand, moss), gold lip, lights, colour grade and ambient particles (petals, embers, snow, fireflies, blowing sand). `tools/calibrate_arenas.py <id>` tunes the marble colours against the painting (dev server running).

### Board turning
The slider at the bottom of the game screen turns the 3D board (pieces, highlights and effects turn with it). At 0/90/180/-90 degrees it sits exactly on the painted board; in between, a plain plinth top and a 3D gold frame replace the painted board, and the board shrinks slightly to stay on the plinth. Clicks, drags, pop-up words and the duel camera all work at any angle.

### Test and debug URL options
`?play` (local game, no menus) · `?vs=beginner|easy|medium|hard` · `?side=b` · `?duel=short|off` · `?time=600` · `?fen=...` · `?challenge=<id>` · `?menu=side|arena|play` · `?overlay` (alignment grid) · `?noambience` · `?mute` · `?guide` / `?guide=0` · `?fps` (on-screen frame counter) · `?fen=...&anim=<role>` (every piece plays a role; `node tools/gallery.mjs`) · `?empty` · `?arena=<id>`

## Source map
| Area | Files |
|---|---|
| Scene (camera match, plates, board, lighting, post) | `src/scene/` |
| Pieces (Meshy loader via manifest, placeholders, procedural motion) | `src/pieces/` |
| Rules wrapper, clock, board view, highlights, duels, challenges, saves | `src/game/` |
| Engine (0x88 board, alpha-beta, worker) | `src/ai/` |
| HUD, menus, icons | `src/ui/` |
| Audio (synthesised) | `src/audio/` |
| Asset and measurement scripts | `tools/` |

## Adding content without code
- **A new Meshy piece:** drop a folder `MESHY ASSETS\<LIGHT|DARK> - <PIECE> ANIMATIONS\` with one GLB, run `npm run assets`. The piece replaces its placeholder.
- **A new challenge:** add an entry to `public/data/challenges.json` (goals, fail conditions, star tiers, progress lines).
- **Menu hotspots:** edit the pixel boxes in `tools/screens.py` and re-run it; it rewrites `public/data/screens.json`.
