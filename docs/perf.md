# Performance gate: 5,000 walkers at x3

Scenario: 200x120 floor, 60 seeded obstacle rects, 4 target areas, 5,000 walkers (all 12 shape/fill combinations), respawned at a random edge on arrival. Seed 1.

Headless sim: `npm run bench:sim` (600 frames after 30 warm-up, 3 SIM_DT steps per frame, no drawing).
Browser: `/bench.html` via `npm run dev`; read `window.__bench` after 20 s.

| Date | Machine | Scenario | Sim ms/frame mean | Sim ms/frame p95 | fps | Draw ms |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-19 | M-series Mac (controller to confirm) | 5,000 walkers, x3 (3 steps/frame) | 2.60 | 2.71 | TBD (browser check) | TBD (browser check) |

Gate: PASS if fps >= 55 and sim + draw <= 12 ms per frame.
