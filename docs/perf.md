# Performance gate: 5,000 walkers at x3

Scenario: 200x120 floor, 60 seeded obstacle rects, 4 target areas, 5,000 walkers (all 12 shape/fill combinations), respawned at a random edge on arrival. Seed 1.

Headless sim: `npm run bench:sim` (600 frames after 30 warm-up, 3 SIM_DT steps per frame, no drawing).
Browser: `/bench.html` via `npm run dev`; read `window.__bench` after 20 s.

| Date | Machine | Scenario | Sim ms/frame mean | Sim ms/frame p95 | fps | Draw ms |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-19 | M-series Mac (controller to confirm) | 5,000 walkers, x3 (3 steps/frame) | 2.60 | 2.71 | TBD (browser check) | TBD (browser check) |

Gate: PASS if fps >= 55 and sim + draw <= 12 ms per frame.

## Notes

- `drawMs` times command recording on the main thread only, not rasterisation or GPU work. **fps is authoritative.**
- People are drawn with instanced WebGL2 (one draw call per shape/fill pass, all 5,000 drawn, no culling); the floor and obstacles are a static offscreen canvas blitted each frame.
- Browser sim time per step is about 2-3x the back-to-back headless figure (0.9 ms/step): with idle gaps between frames the same code measures ~3 ms/step in plain node, so the gap is cold caches/clock behaviour between frames, not browser overhead or dev mode.
- Auto run: open `/bench.html?auto=1` (add `&zoom=1` or `&zoom=2`); after 5 s warm-up it records 15 s and writes `window.__benchResult` (fpsMean, fpsP5, simMs, drawMs, zoom). `node scripts/benchChrome.mjs <url>` does that in headless Chrome.

## Browser rows (controller to fill in)

| Date | Zoom | fps mean | fps p5 | sim ms | draw ms | Result |
| --- | --- | --- | --- | --- | --- | --- |
| TBD | default | TBD | TBD | TBD | TBD | TBD |
| TBD | 1 | TBD | TBD | TBD | TBD | TBD |
| TBD | 2 | TBD | TBD | TBD | TBD | TBD |

Informal headless-Chrome check by the implementer (production build, dpr 2, 1564x1300, likely software or virtual GPU, not authoritative): default zoom 60.0 fps (p5 59.9), sim 2.7 ms; zoom 1: 60.0 / 59.9, sim 2.8 ms; zoom 2: 60.0 / 59.5, sim 2.6 ms. Dev server: sim 3.1 ms.
