# Third-party licences

Every third-party dependency and asset used by the PoC. Checked 29 October 2026 against the npm / PyPI registry metadata.

## Shipped in the game (dist)
| Item | Version | Licence | Source |
|---|---|---|---|
| three (incl. GLTFLoader, SkeletonUtils, meshopt decoder from three/examples) | 0.186.1 | MIT | npm |
| postprocessing (pmndrs) | 6.39.5 | Zlib | npm |
| chess.js | 1.4.0 | BSD-2-Clause | npm |
| howler | 2.2.4 | MIT | npm |
| Cinzel font (700) | @fontsource/cinzel 5.3.0 | SIL OFL 1.1 | npm, hosted locally |
| Cinzel Decorative font (700) | @fontsource/cinzel-decorative 5.3.0 | SIL OFL 1.1 | npm, hosted locally |

## Development only (not shipped)
| Item | Version | Licence |
|---|---|---|
| vite | 8.3.5 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| vitest | 5.0.5 | MIT |
| playwright | 1.64.1 | Apache-2.0 |
| @gltf-transform/cli, core, extensions, functions | 4.5.1 | MIT |
| meshoptimizer (encoder) | 1.3.0 | MIT |
| sharp | 0.35.5 | Apache-2.0 |
| @types/three, @types/howler, @types/node | current | MIT |
| numpy | 2.5.4 | BSD-3-Clause |
| opencv-python-headless | 5.0.0 | Apache-2.0 |
| pillow | 13.0.0 | MIT-CMU (HPND) |

## Art
| Asset | Owner / licence |
|---|---|
| Palace Garden image, menu screens, concept art | Harry's own (AI-generated, supplied by him) |
| HUD portraits (public/assets/ui/portraits) | Cropped by tools/portraits.py from Harry's T-pose concept art |
| HUD style | Follows Harry's HUD reference image (29 Oct 2026); built in CSS, no image taken from it |
| All 12 character models and their animations | Harry's own (Meshy exports); clips retargeted between them and the knights' leg rigs repaired by tools/ scripts |
| Fireball and spell effects | Generated in code (src/fx/effects.ts) |
| Placeholder pieces | Generated in code (src/pieces/placeholders.ts) |
| Marble textures, effect sprites, white flag | Generated in code at runtime |
| HUD icons | Drawn in code for this project (src/ui/icons.ts) |

## Audio
All sound effects (including the capture cheer and the clang / sad wah-wah) and both music tracks are **synthesised in code** at start-up (src/audio/sound.ts; game music src/audio/gameMusic.ts, rendered in a worker). The in-game music is an original composition written for this project in a classical style (Alberti bass, harpsichord, chiptune lead); it does not quote any existing piece. No third-party audio files are used, so there is nothing to licence. The brief suggested CC0 packs such as Kenney; synthesis was chosen so nothing had to be downloaded. Recorded CC0 sounds can replace them later by swapping the source of each Howl.

## Excluded on purpose
GSAP (non-standard licence), Stockfish (GPL), js-chess-engine (not needed: in-house engine used).
