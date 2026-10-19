# Balance

How the station is tuned and how to check it. `npm run balance` plays every check below and prints a PASS or FAIL line for each, exiting 1 on any FAIL. It takes about 100 s.

`npm run balance idle|autoplay [days] [seeds]` prints one player's per-day table. `npm run balance needs [seeds]` runs only the whole-day toilets-and-seating check. The fast checks, each at most 2 game days, run in `npm test` (`tests/sim/balance.test.ts`).

## The scripted player

`src/sim/autoplay.ts` is a "reasonable player" used as a test tool. It builds only through `previewPlacement`/`applyPlacement` and `evictTenant`. It acts once every game hour, and always keeps 3,000 in the bank:

- **Gates:** opens a gate on an island whose gate queue stays long. That means more than 8 people within 2 rows of the gate line for 15 minutes, with a short minute taking one off the count rather than resetting it, because queues come and go with each train.
- **Concourse corridor:** while the meter is heading for growth, extends a 3-wide corridor below the islands' feet to the next platform's island.
- **Entrance approaches:** widens the approaches to entrances A and B, by 2 tiles each side at 3 platforms and by 4 at 6.
- **Per island (every two platforms):** adds
  - a food unit on the concourse below the foot, evicting any tenant that is not food and drink;
  - a toilet and seating on the island's centre, with the toilet near the gates;
  - a toilets sign on the foot.
- **Footbridge (entrance C):** builds the route to the footbridge only at 12 platforms, past this plan's targets, with toilets along it. Built at 6, 8 or 10 platforms it cost 10 to 20 points of weekday on-time rate. About a third of passengers then use C, and on that long walk their toilet needs catch up with them. Measured with seed 1 at 0.75x and 0.6x demand:

| Footbridge route built at | Weekday on-time once built |
| --- | --- |
| 6 platforms | 77-87% |
| 8 platforms | 76-87% |
| 10 platforms | 62-86% |
| Not built | 78-100% at the same platform counts |

## Targets (final run, seeds 1-3)

| Target | Measured | Result |
| --- | --- | --- |
| Idle player stays at 2-3 platforms over 3 game days | 3 platforms, all seeds | PASS |
| Autoplay reaches 6 platforms in game days 9-15 | game day 9 (1.5 h at x1), all seeds | PASS |
| Autoplay reaches 10 platforms in game days 18-24 | game day 20 (3.3 h at x1), all seeds | PASS |
| Autoplay money stays positive after day 2 | lowest balance 1,463 / 2,057 / 2,763 | PASS |
| Typical concourse shop near rent x1.0 (median from day 4 on) | x1.19 / x1.12 / x1.05 | PASS |
| Whole day, roomy station: toilets and seating at least 5 points better | 93.2% with, 86.6% without (+6.6) | PASS |
| `npm test`: desperate passengers miss more often at equal spare time | over 2x the miss rate (about 25% against 1-4%) | PASS |
| `npm test`: toilets cut desperate walking person-minutes by at least 25% | 94-98% fewer | PASS |
| `npm test`: with 2 gates a queue forms at the busiest island, and opening its gates cuts it | island 2 peaks 43-65, falling to 35-41 with all its gates open | PASS |
| `npm test`: the multi-seed on-time bars (2 gates and all gates) | unchanged and passing | PASS |

All three seeds grow on the same days, because growth needs a good stretch after each cooldown and weekends supply one most reliably.

## Final table: autoplay, seed 1

Game days are numbered from 1.

```
day |  added | active | on-time | worst meter |  balance |   income |  upkeep | moved | peak gate q | gates     | rent x
  1 |     3 |      3 |   99.7% |       97.7% |    3,087 |    2,572 |   1,346 |   902 |          19 | 52        | 
  2 |     3 |      3 |   99.9% |       99.3% |    5,156 |    3,427 |   1,346 |  1143 |          21 | 52        | 0.60
  3 |     3 |      3 |   99.9% |       99.3% |    7,285 |    3,487 |   1,346 |  1173 |          20 | 52        | 0.61
  4 |     4 |      4 |   99.9% |       99.4% |    3,013 |    4,323 |   1,448 |  1496 |          21 | 55        | 0.68
  5 |     4 |      4 |   99.7% |       98.8% |    2,230 |    4,725 |   1,448 |  1605 |          21 | 55        | 0.68 0.94
  6 |     5 |      5 |  100.0% |       99.0% |    4,399 |    4,122 |   1,800 |  1310 |          16 | 552       | 0.60 0.80
  7 |     5 |      5 |  100.0% |      100.0% |    7,161 |    4,606 |   1,800 |  1440 |          13 | 552       | 0.62 0.87
  8 |     5 |      5 |   99.5% |       98.2% |    9,081 |    5,930 |   1,840 |  1975 |          24 | 552       | 0.86 1.15
  9 |     6 |      6 |   97.1% |       91.6% |    3,637 |    7,001 |   1,977 |  2360 |          26 | 552       | 0.99 1.41
 10 |     6 |      6 |   97.1% |       87.0% |    1,463 |    7,105 |   2,099 |  2416 |          32 | 552       | 0.97 1.43 0.60
 11 |     7 |      7 |   97.2% |       90.2% |    3,781 |    7,166 |   2,475 |  2511 |          42 | 5522      | 0.98 1.56 0.67
 12 |     7 |      7 |   94.4% |       79.6% |    7,545 |    8,380 |   2,475 |  2895 |          52 | 5522      | 1.14 1.72 0.72
 13 |     7 |      7 |  100.0% |       99.5% |   11,511 |    6,452 |   2,475 |  2004 |          17 | 5522      | 0.82 1.20 0.60
 14 |     8 |      8 |   99.9% |       99.2% |   12,043 |    6,920 |   2,532 |  2186 |          19 | 5522      | 0.88 1.36 0.71
 15 |     8 |      8 |   93.1% |       78.9% |   14,354 |    9,176 |   2,577 |  3151 |          44 | 5552      | 1.23 1.90 1.09 0.96
 16 |     9 |      9 |   92.4% |       67.5% |   14,836 |    9,219 |   2,977 |  3276 |          50 | 55522     | 1.29 1.94 1.08 0.97
 17 |     9 |      9 |   91.2% |       76.7% |   18,146 |   10,139 |   2,977 |  3487 |          52 | 55522     | 1.39 2.00 1.21 1.12
 18 |     9 |      9 |   91.2% |       75.8% |   21,490 |   10,175 |   2,977 |  3508 |          70 | 55522     | 1.35 2.00 1.18 1.03
 19 |     9 |      9 |   83.3% |       58.5% |   21,070 |   10,117 |   2,977 |  3772 |          90 | 55522     | 1.46 2.00 1.27 1.11
 20 |    10 |     10 |   99.6% |       97.0% |   23,006 |    8,745 |   3,034 |  2720 |          27 | 55522     | 1.07 1.72 1.01 0.90
 21 |    10 |     10 |   99.6% |       97.9% |   28,667 |    8,827 |   3,034 |  2756 |          21 | 55522     | 1.04 1.75 1.00 0.87 0.60
 22 |    10 |     10 |   80.2% |       54.5% |   25,000 |   10,563 |   3,066 |  4009 |         104 | 55522     | 1.45 2.00 1.40 1.23 0.60
 23 |    10 |     10 |   78.1% |       47.3% |   21,551 |   10,167 |   3,066 |  3975 |         100 | 55522     | 1.41 2.00 1.56 1.41 0.60
 24 |    10 |     10 |   83.1% |       53.5% |   20,805 |   10,147 |   3,066 |  3784 |          94 | 55522     | 1.45 2.00 1.40 1.27 0.60
 25 |    10 |     10 |   81.9% |       54.4% |   19,735 |   10,542 |   3,066 |  3917 |         107 | 55522     | 1.48 2.00 1.35 1.19 0.60
 26 |    10 |     10 |   79.4% |       49.8% |   17,316 |   10,811 |   3,066 |  4107 |         103 | 55522     | 1.50 2.00 1.39 1.24 0.60
```

How to read it:

- **gates:** open gates per opened island.
- **rent x:** each let unit's multiplier for the next day.
- **peak gate q:** the most people bunched at any one island's gate line.
- **Weekdays from 9 platforms:** they sit at 78-91%, with worst 2-hour readings of 47-77%. So late growth comes on weekends; demand on Saturday and Sunday is about half a weekday's.

Idle player, seed 1:

```
day |  added | active | on-time | worst meter |  balance |   income |  upkeep | moved | peak gate q | gates     | rent x
  1 |     3 |      3 |   98.6% |       96.7% |   21,363 |    2,572 |     988 |   896 |          25 | 22        | 
  2 |     3 |      3 |   98.2% |       94.5% |   23,409 |    3,360 |     988 |  1158 |          17 | 22        | 
  3 |     3 |      3 |   98.1% |       94.8% |   25,599 |    3,464 |     988 |  1185 |          14 | 22        | 
```

## Constants changed

| Constant | Before | After | Why |
| --- | --- | --- | --- |
| `SPAWN_PER_MIN_PER_PLATFORM` | 0.3 | 0.18 | Demand per platform is 0.6x. Entrances A and B are fixed, so whole-station load grows with the platform count. At 1x the station jammed at the entrances beyond about 5 platforms; at 0.75x, once needs had a cost, weekdays at 6-7 platforms fell to 80-89%. |
| `ALIGHT_BASE` (timetable.ts) | 6 | 3.6 | Scaled with the spawn rate, so arrivals and departures stay in proportion. |
| `SUSTAIN_MIN` | 180 | 480 | Growth needs 8 good hours in a row, so a peak that goes badly blocks it that day. |
| `COOLDOWN_MIN` | 240 | 3000 | Paces growth to about one platform every 2-3 game days: 6 platforms on game day 9 and 10 on game day 20. The idle player's second platform would come after its third day. 3,150 pushed 10 platforms past day 26; 2,520 opened them too early. |
| `RENT_FOOTFALL_REF` | 300 | 1300 | At 300 nearly every unit hit the ×2.0 cap. At 1,300 the median multiplier from day 4 on is ×1.05-1.19 across seeds. |
| `DESPERATE_AFTER_MIN` | 20 | 15 | With the two ruled mechanics, desperation lasts until a toilet visit, and someone tired and not sitting walks at ×0.85. At 12 minutes one seed of the starting station fell to 0.957, under the 0.965 all-gates bar. 15 clears both bars: 2 gates min 0.972 and mean 0.982, all gates min 0.978 and mean 0.988. |
| `DESPERATE_SPEED_MUL` | 0.7 | 0.3 | At 0.5-0.7, going without a toilet cost about as much as using one, since a visit takes 10+ game minutes at walking pace. At 0.3 the roomy station gains 6.6 points from its toilets. |
| `DRIFT_PER_TILE` | 0.25 | 0.5 | As above: a desperate walker's detours are what toilets save. |
| `FATIGUE_SPEED_MUL` | (new) | 0.85 | The ruled fatigue: someone tired and not sitting walks slower until they have sat down. |
| Toilet need rate (needs.ts) | 1/180 | 1/60 per minute | Enough passengers need a toilet during their visit for toilets to matter. |
| `TOILET.serveMin` (facilities.ts) | 3 | 1 | A visit has to beat going without, which is the floor the ruling set. |

Unchanged on purpose: `GATE_INTERVAL_SEC` 0.25 and `GROW_RATE` 0.9.

- **`GATE_INTERVAL_SEC` 0.25:** it already gives queues at the busiest island with 2 gates. 0.35-0.45 still passed the 2-gate bar but jammed islands that had all 5 gates open.
- **`GROW_RATE` 0.9:** with the long sustain, 0.93-0.95 left the autoplay player growing only on weekends.

Prices, upkeep, starting cash and the fare bonus are also unchanged. Cheaper floor and a bigger fare were tried but not needed once the footbridge route moved to 12 platforms.

Sample-size floors in tests (">200 outcomes in 6 h") now scale with `SPAWN_PER_MIN_PER_PLATFORM` (`scaledByDemand` in `tests/sim/helpers.ts`). The growth, rent and gate tests take their values from the constants, so retuning does not break them. On-time bars were not loosened.

## Needs: what matters where

- **Whole day, in a roomy station** (8 platforms, every gate open, an 8-row hall, five hall toilets plus a toilet and seating on each island): toilets and seating are worth 6.6 points of on-time rate (93.2% against 86.6%, seeds 1-3).
- **Peak hours: toilet placement is the challenge.** At a weekday peak a badly placed toilet can cost more than it saves.
  - A toilet visit takes 10-15 game minutes at walking pace.
  - Queues that cross the concourse or a gate line add to the crush.
  - A toilet on the concourse makes island passengers cross the gates twice more. With only 2 gates per island, concourse toilets lowered the whole-day rate by 5 points.
  - The fix is the player's: put toilets near where needs arise, out of the main flow, and open the gates.
- **Seating:** about neutral for on-time. It helps tired passengers who are waiting, and they board anyway. Its value is in fatigue for passengers who sit down before walking on.
