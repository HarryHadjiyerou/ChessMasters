# Palace Garden scene: how it is built

## Pipeline (all scripted, run in this order)
| Step | Script | Output |
|---|---|---|
| Copy source image | (manual copy into `tools\work\`, source is read-only) | `tools/work/palace_garden.png` |
| Measure board corners | `tools/measure_board.py` | `tools/work/board_corners.json`, overlay preview |
| Solve camera | `tools/solve_camera.py` (`npm run camera`) | `public/assets/scene/palace_garden_camera.json` |
| Cut plates, sample colours | `tools/make_plates.py` | `palace_garden_bg.webp`, `_fg.webp`, `_blur.jpg`, `_colours.json` |
| Screenshots | `tools/screenshots.mjs` (`npm run shots`) | 1536×1024, pixel-aligned with the source |
| Colour check | `tools/compare_colours.py` | mean square colour, render vs painting |
| Report sheets | `tools/make_sheets.py` | side-by-side, corner zoom sheet |

## Board measurement
The painted checker area is found from the image itself: all 32 dark squares are masked, their convex hull is taken, and one line is fitted per side (the outer edges of edge-row dark squares lie on the boundary). The corners are where neighbouring lines intersect, so a light corner square doesn't throw the result off.

Measured corners (px, 1536×1024): a1 (649.4, 790.2), h1 (1306.8, 525.0), h8 (894.6, 220.2), a8 (306.4, 379.5).

The painted grid isn't perfectly straight (AI art). Near h1 the painted squares bulge about 5 px past the fitted line. A thin 3D gold lip (0.12 square wide) around the 3D board covers this.

## Camera solve
- With a centred lens, a 4-point planar solve leaves 4–6 px error, because the painting isn't a perfectly consistent perspective.
- Instead, focal length **and** principal point are solved from the board homography (orthogonality and equal-length constraints for a square target). The solution nearest the image centre is used: f = 2161.0 px, principal point (982.5, 531.3), which is 214 px right of centre.
- Reprojection error: 0.000 px (Python); 0.0003 px measured in the browser.
- Rendered with an asymmetric frustum (`src/scene/MatchedCamera.ts`). Duel punch-ins crop the same rectangle out of the frustum and both plates, so alignment holds while zoomed.

## Orientation
- Player's home rank is the stairs / crown-plaque edge: a1 = bottom corner, h1 = right corner of the image.
- Dark: the camera doesn't move; squares are mapped 180°. Covered by `tests/boardLayout.test.ts`.

## Foreground plate
Everything below the two near edges, cut along the outer edge of the painted gold frame (0.42 squares outside the playing area, projected through the solved camera): plinth faces, stairs, bushes, near finials, the left cypresses. Pieces always stand above those edges on screen, so they are never wrongly hidden, and anything nearer the viewer draws over them.

## Lighting
Read from the painting:
- Pillar faces turned towards the a-file side are lit and faces towards the stairs are shaded, so the key sun comes from −x, low.
- The sky glows top-right, so a warm rim light comes from the far right.
- A warm hemisphere light adds fill.

## Tone mapping
ACES Filmic, applied to the 3D layer only inside `CompositePass`, so the painting keeps its own colours. AgX was tried first: it lifted the dark squares to brown and flattened the contrast against the painting.

## Colour match (render vs painting, mean sRGB)
| | Painting | Render | Error |
|---|---|---|---|
| Light squares | 233 / 167 / 114 | 239 / 172 / 110 | within 4% |
| Dark squares | 79 / 56 / 44 | 90 / 54 / 40 | red +13%, others within 10% |

## Upscaling
Not done. The optional Real-ESRGAN step needs an external binary download, and I left it out so nothing is installed without approval. The backdrop is the original 1536×1024: sharp at 1536 wide, slightly soft at 1620×1080 in a 1080p window, and softer during duel zooms.
