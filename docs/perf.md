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

## Browser gate: PASSED

Machine: user's Mac, real Chrome (visible tab), production build via `vite preview`, viewport 1564x1300 CSS px, devicePixelRatio 2, `?auto=1` (5 s warm-up, 15 s recorded), 5,000 people, x3 speed. Measured 2026-10-19 at commit a03454f.

| zoom | fps mean | fps p5 | sim ms | draw ms |
| --- | --- | --- | --- | --- |
| 0.49 (fit) | 59.7 | 57.1 | 5.12 | 0.84 |
| 1 | 60.0 | 57.1 | 5.16 | 0.99 |
| 2 | 59.7 | 57.1 | 5.23 | 0.98 |

Gate: fps >= 55 and sim + draw <= 12 ms: PASS at every zoom.

The headless-Chrome numbers (60 fps, sim 2.6-2.8 ms) were an informal implementer check only; the GPU path there is unconfirmed, so the real-Chrome rows above are the authoritative ones.
