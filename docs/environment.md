# Environment

Recorded 29 October 2026.

## Machine
| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26300 |
| CPU | AMD Ryzen 5 7520U with Radeon Graphics |
| GPU | AMD Radeon 610M (integrated, ~2 GB shared), driver 32.0.11039.13000 |
| RAM | 13.8 GB |
| Display | 1920 × 1080 |

The Radeon 610M is an entry-level integrated GPU. Measured in headless Chromium at 1920x1080 with 32 pieces: 60 fps baseline (browser cap) after fixing a HUD repaint bug; 95th-percentile frame 16.8 ms. Headless Chromium also drops occasional frames (0.4 to 2 s gaps with no main-thread work, also with sound muted), so a check on the real display is still needed: open the game with ?fps.

## Tools
| Tool | Version | How installed |
|---|---|---|
| Node.js | 26.13.0 (LTS) | `winget install OpenJS.NodeJS.LTS` (29 Oct 2026) |
| npm | 11.20.0 | with Node |
| Git | 2.56.0.windows.3 | `winget install Git.Git` (29 Oct 2026) |
| Python | 3.14.5 | pre-installed; tool scripts use a local venv at `tools\.venv` |
| Playwright Chromium | bundled with playwright 1.64.1 | `npx playwright install chromium` |

## npm packages (exact installed versions)
| Package | Version | Licence | Use |
|---|---|---|---|
| three | 0.186.1 | MIT | rendering |
| postprocessing | 6.39.5 | Zlib | post-processing |
| chess.js | 1.4.0 | BSD-2-Clause | chess rules |
| howler | 2.2.4 | MIT | audio |
| vite | 8.3.5 | MIT | build / dev server |
| typescript | 7.0.2 | Apache-2.0 | type checking |
| vitest | 5.0.5 | MIT | unit tests |
| playwright | 1.64.1 | Apache-2.0 | screenshots / smoke tests |
| @gltf-transform/cli, core, extensions, functions | 4.5.1 | MIT | asset optimisation |
| meshoptimizer | 1.3.0 | MIT | meshopt compression |
| sharp | 0.35.5 | Apache-2.0 | image processing (WebP textures) |
| @types/three | 0.186.0 | MIT | types |
| @types/howler | 2.2.13 | MIT | types |
| @types/node | current | MIT | types (tests) |
| @fontsource/cinzel, @fontsource/cinzel-decorative | 5.3.0 | OFL-1.1 | fonts, hosted locally |

Tweens use a small in-house helper (no tween library).

## Python packages (tools\.venv)
| Package | Version | Licence | Use |
|---|---|---|---|
| numpy | 2.5.4 | BSD-3-Clause | maths |
| opencv-python-headless | 5.0.0 | Apache-2.0 | camera solve (solvePnP), image cutting |
| pillow | 13.0.0 | MIT-CMU (HPND) | image I/O |

Recreate with:
```
python -m venv tools\.venv
tools\.venv\Scripts\python -m pip install numpy opencv-python-headless pillow
```
