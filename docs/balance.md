# Balance

How the station is tuned and how to check it. `npm run balance` plays every check below and prints a PASS or FAIL line for each, exiting 1 on any FAIL. It plays 49 game days per seed (through the first summer holidays, game days 29-42, and the week after) and takes about 200 s.

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

## Growth and shrinking

The service meter moves platforms by three rules:

- **Grow:** a 2-hour on-time rate at or above `GROW_RATE` (0.9) held for `SUSTAIN_MIN` (480 minutes) reopens the lowest inactive platform, else adds the next. It needs the **last closed day's rate at or above `GROW_RATE` too**, so a weekend after a bad week can't grow the station back into a bad Monday.
- **Shrink, by the hour:** a rate below `SHRINK_RATE` (0.8) held for `SUSTAIN_MIN` closes the highest active platform above the starting two.
- **Shrink, by the day:** at each midnight, a day whose counted (not disruption-excluded) on-time rate was below `SHRINK_RATE` on `SHRINK_DAYS` (1) days in a row closes one platform, cooldown or not. A weekday that fails at its peaks rarely stays below the rate for 480 minutes at a stretch, so the hourly rule alone almost never fired.

Each move starts the `COOLDOWN_MIN` (3,000 minute) cooldown. A platform, once added, is never removed: closing one cancels its services yet to arrive (a train already standing still departs) and rebooks their passengers.

## The first summer

Summer holidays fill the July and August weeks (game days 29-42). Weekday demand is `x1.15` (it was `x1.3`).

With `x1.3`, no daily rule and `SHRINK_RATE` 0.7, the autoplay station went into summer at 11 platforms, ran weekdays at 50-64% on time with worst 2-hour readings of 19-31%, and lost about 20,000 a weekday: -136,000 to -210,000 by game day 38-40 and still falling into September. Weekends kept growing it (platform 12 opened in July).

Now, seeds 1-3: the daily rule closes 1-2 platforms in the first summer week and more as needed; weekdays run 72-95% on time; the balance never goes below zero (lowest summer balances 10,676 / 12,326 / 35,885). Platforms reopen on the weekends and after the holidays.

## Targets (final run, seeds 1-3)

| Target | Measured | Result |
| --- | --- | --- |
| Idle player stays at 2-3 platforms over 3 game days | 3 platforms, all seeds | PASS |
| Autoplay reaches 6 platforms in game days 9-15 | game day 9, all seeds | PASS |
| Autoplay reaches 10 platforms in game days 18-24 | game day 21 / 28 / 49 | **FAIL (seeds 2, 3)** |
| Autoplay money stays positive after day 2, up to the summer | lowest 3,178 / 1,238 / 2,353 | PASS |
| Typical concourse shop near rent x1.0 (median from day 4 up to the summer) | x1.04 / x0.99 / x1.11 | PASS |
| Balance never below -20,000 over 49 days | lowest 3,047 / 1,238 / 2,353 | PASS |
| Balance positive within 7 days of the summer's end | positive throughout | PASS |
| Platforms close in the summer | game days 29, 30, 33 / 29, 30, 37, 40 / 29, 36 | PASS |
| And reopen afterwards | first on game day 37 / 35 / 35 | PASS |
| Whole day, roomy station: toilets and seating at least 5 points better | 90.2% with, 84.9% without (+5.4) | PASS |
| `npm test` bars (gates, needs, on-time) | unchanged and passing | PASS |

**Why 10 platforms now comes late on seeds 2 and 3.** A passenger who misses their train is now rebooked like anyone whose service is cancelled, with the new service's departure as their deadline (before, they kept the deadline already past, so they ran no errands and left seats and queues). That costs weekdays at 8-9 platforms a few points (88-92% rather than 91-96%), so the weekday growth these seeds used to get at 8 platforms rarely holds 480 minutes at 0.9, and at 0.8 the daily rule can close a platform in June (seed 3, game day 23). Seed 2 reaches 10 a weekend later; seed 3 not until after the summer.

Levers tried, 49 days, seeds 1-3 (each row: when 10 platforms came, lowest balance):

| Change from the final settings | 6 platforms | 10 platforms | Lowest balance |
| --- | --- | --- | --- |
| None (final) | day 9 | 21 / 28 / 49 | 3,047 / 1,238 / 2,353 |
| `GROW_RATE` 0.88 | day 8 | 21 / 28 / 28 | 959 / 2,126 / 1,755 (with cooldown 2,700) |
| `SHRINK_RATE` 0.75 | day 9 | 21 / 28 / 28 | -12,079 / 1,238 / -1,865 |
| `SHRINK_RATE` 0.75, no day gate on growth | day 9 | 20 / 27 / 27 | 360 / 1,238 / -4,632 |
| `SHRINK_DAYS` 2 | day 9 | 21 / 28 / 28 | -39,006 / -15,264 / -13,093 |
| `COOLDOWN_MIN` 2,800 | day 8 | 28 / 21 / 28 | all positive |
| `COOLDOWN_MIN` 2,640 | day 8 | 21 / 20 / 49 | all positive |
| `COOLDOWN_MIN` 2,400 | **day 7** | 21 / 21 / 21 | all positive |
| `SUSTAIN_MIN` 420 | day 8 | 28 / 28 / 21 | all positive |

Every cooldown short enough to bring 10 platforms by day 24 on all seeds brings 6 before day 9; at 3,000 the late stage depends on one weekday growth that now rarely comes.

## Final table: autoplay, seed 1

Game days are numbered from 1. **shut+open:** platforms closed (-) and reopened (+) that day.

```
day |  added | active | on-time | worst meter |  balance |   income |  upkeep | shut+open | moved | peak gate q | gates     | rent x
  1 |     3 |      3 |   99.6% |       97.7% |    3,047 |    2,532 |   1,346 |       |   890 |          19 | 52        | 
  2 |     3 |      3 |   99.7% |       97.8% |    5,093 |    3,514 |   1,346 |       |  1196 |          16 | 52        | 0.62
  3 |     3 |      3 |  100.0% |      100.0% |    7,074 |    3,418 |   1,346 |       |  1178 |          19 | 52        | 0.60
  4 |     4 |      4 |   99.7% |       98.6% |    5,188 |    4,438 |   1,433 |       |  1534 |          25 | 54        | 0.71
  5 |     4 |      4 |   99.7% |       98.2% |    7,754 |    4,574 |   1,448 |       |  1569 |          23 | 55        | 0.72 0.86
  6 |     5 |      5 |  100.0% |      100.0% |    8,047 |    4,143 |   1,840 |       |  1285 |          15 | 552       | 0.60 0.72
  7 |     5 |      5 |  100.0% |      100.0% |   10,668 |    4,494 |   1,840 |       |  1425 |          14 | 552       | 0.63 0.87
  8 |     5 |      5 |   98.8% |       95.8% |   14,480 |    6,034 |   1,840 |       |  2001 |          25 | 552       | 0.90 1.10
  9 |     6 |      6 |   98.7% |       95.9% |    3,178 |    6,886 |   2,099 |       |  2345 |          28 | 552       | 0.92 1.46
 10 |     6 |      6 |   97.7% |       91.0% |    6,814 |    6,675 |   2,099 |       |  2313 |          34 | 552       | 1.00 1.33 0.60
 11 |     7 |      7 |   96.9% |       87.1% |    8,985 |    7,160 |   2,475 |       |  2489 |          35 | 5522      | 1.02 1.47 0.62
 12 |     7 |      7 |   94.6% |       85.3% |   12,869 |    8,188 |   2,475 |       |  2815 |          49 | 5522      | 1.18 1.59 0.66
 13 |     7 |      7 |  100.0% |      100.0% |   16,319 |    5,954 |   2,475 |       |  1872 |          16 | 5522      | 0.83 1.07 0.60
 14 |     8 |      8 |   98.8% |       90.9% |   14,764 |    6,819 |   2,577 |       |  2238 |          24 | 5552      | 0.92 1.40 0.68
 15 |     8 |      8 |   91.9% |       76.2% |   18,172 |    9,234 |   2,577 |       |  3232 |          67 | 5552      | 1.37 1.82 0.88 0.73
 16 |     9 |      9 |   94.9% |       86.0% |   19,649 |    8,976 |   2,977 |       |  3087 |          48 | 55522     | 1.28 1.78 0.89 0.75
 17 |     9 |      9 |   87.6% |       65.4% |   20,467 |    9,282 |   2,977 |       |  3481 |          90 | 55522     | 1.45 2.00 1.11 0.97
 18 |     9 |      9 |   85.6% |       62.3% |   21,194 |    9,944 |   2,977 |       |  3604 |         114 | 55522     | 1.44 2.00 1.11 0.94
 19 |     9 |      9 |   86.6% |       59.6% |   22,448 |   10,236 |   2,977 |       |  3703 |         109 | 55522     | 1.50 2.00 1.13 0.93
 20 |     9 |      9 |   99.7% |       98.1% |   27,194 |    7,807 |   2,977 |       |  2462 |          20 | 55522     | 1.04 1.48 0.78 0.65
 21 |    10 |     10 |   99.6% |       97.7% |   22,037 |    7,985 |   3,034 |       |  2550 |          20 | 55522     | 1.02 1.59 0.87 0.74
 22 |    10 |     10 |   80.7% |       53.3% |   20,306 |   10,217 |   3,034 |       |  3851 |         101 | 55522     | 1.46 2.00 1.27 1.07 0.60
 23 |    10 |     10 |   80.8% |       49.8% |   18,814 |   10,794 |   3,034 |       |  4017 |         143 | 55522     | 1.51 2.00 1.40 1.17 0.60
 24 |    10 |     10 |   83.6% |       57.2% |   18,732 |   10,608 |   3,034 |       |  3885 |         116 | 55522     | 1.52 2.00 1.33 1.11 0.60
 25 |    10 |      9 |   79.6% |       53.5% |   15,715 |   10,275 |   3,049 |    -1 |  3924 |         145 | 55532     | 1.51 2.00 1.28 1.07 0.60
 26 |    10 |      9 |   85.7% |       62.6% |   16,505 |   10,082 |   3,049 |       |  3615 |          90 | 55532     | 1.39 2.00 1.14 0.94 0.60
 27 |    10 |      9 |   99.5% |       97.9% |   21,097 |    7,938 |   3,049 |       |  2505 |          21 | 55532     | 1.02 1.54 0.81 0.68 0.60
 28 |    10 |     10 |   99.8% |       99.0% |   24,358 |    8,099 |   3,081 |    +1 |  2533 |          21 | 55532     | 1.02 1.57 0.88 0.75 0.60
 29 |    10 |      9 |   73.3% |       43.4% |   17,404 |   10,925 |   3,081 |    -1 |  4567 |         217 | 55532     | 1.79 2.00 1.38 1.10 0.60
 30 |    10 |      8 |   78.1% |       50.9% |   12,405 |   10,169 |   3,111 |    -1 |  4131 |         164 | 55552     | 1.59 2.00 1.31 1.06 0.60
 31 |    10 |      8 |   84.3% |       63.9% |   12,241 |    9,775 |   3,111 |       |  3631 |          94 | 55552     | 1.43 2.00 1.09 0.89 0.60
 32 |    10 |      8 |   87.3% |       64.7% |   13,649 |   10,276 |   3,111 |       |  3711 |          88 | 55552     | 1.50 2.00 1.17 0.95 0.60
 33 |    10 |      7 |   79.1% |       50.0% |   10,676 |    9,798 |   3,111 |    -1 |  3859 |         158 | 55552     | 1.59 2.00 1.22 1.01 0.60
 34 |    10 |      7 |  100.0% |       91.2% |   14,452 |    7,098 |   3,111 |       |  2315 |          19 | 55552     | 0.96 1.31 0.66 0.61 0.60
 35 |    10 |      7 |  100.0% |      100.0% |   17,813 |    6,587 |   3,111 |       |  2159 |          18 | 55552     | 0.92 1.23 0.61 0.60 0.60
 36 |    10 |      7 |   94.5% |       86.6% |   21,079 |    8,710 |   3,111 |       |  3138 |          60 | 55552     | 1.29 1.79 0.89 0.74 0.60
 37 |    10 |      8 |   94.8% |       80.9% |   24,863 |    9,093 |   3,111 |    +1 |  3195 |          71 | 55552     | 1.36 1.77 0.89 0.71 0.60
 38 |    10 |      8 |   82.5% |       56.9% |   23,647 |    9,875 |   3,111 |       |  3786 |         136 | 55552     | 1.61 2.00 1.08 0.88 0.60
 39 |    10 |      8 |   86.9% |       67.4% |   24,974 |   10,334 |   3,111 |       |  3759 |         106 | 55552     | 1.59 2.00 1.03 0.80 0.60
 40 |    10 |      8 |   81.7% |       52.7% |   23,146 |    9,909 |   3,111 |       |  3829 |         132 | 55552     | 1.58 2.00 1.05 0.79 0.60
 41 |    10 |      8 |   99.8% |       90.6% |   27,523 |    7,694 |   3,111 |       |  2504 |          22 | 55552     | 1.05 1.50 0.70 0.60 0.60
 42 |    10 |      9 |   99.8% |       99.1% |   33,000 |    8,660 |   3,111 |    +1 |  2780 |          24 | 55552     | 1.14 1.65 0.74 0.60 0.60
 43 |    10 |      9 |   91.1% |       72.4% |   35,985 |   10,027 |   3,111 |       |  3491 |          73 | 55552     | 1.40 2.00 1.06 0.88 0.60
 44 |    10 |      9 |   87.8% |       62.7% |   37,944 |   10,375 |   3,111 |       |  3637 |         100 | 55552     | 1.45 2.00 1.09 0.89 0.60
 45 |    10 |      9 |   87.8% |       66.5% |   39,671 |   10,022 |   3,111 |       |  3537 |          83 | 55552     | 1.42 2.00 1.04 0.85 0.60
 46 |    10 |      9 |   90.8% |       73.5% |   42,879 |   10,207 |   3,111 |       |  3525 |          83 | 55552     | 1.46 2.00 0.98 0.79 0.60
 47 |    10 |      9 |   82.3% |       54.3% |   41,797 |   10,094 |   3,111 |       |  3793 |         115 | 55552     | 1.57 2.00 1.04 0.85 0.60
 48 |    10 |      9 |   99.9% |       98.8% |   46,836 |    8,186 |   3,111 |       |  2517 |          22 | 55552     | 1.09 1.45 0.67 0.60 0.60
 49 |    10 |     10 |   99.8% |       98.7% |   51,234 |    7,855 |   3,111 |    +1 |  2526 |          20 | 55552     | 1.07 1.54 0.75 0.60 0.60
summer weekdays on time 73.3%-94.8%, lowest balance 10,676
```

How to read it:

- **gates:** open gates per opened island.
- **rent x:** each let unit's multiplier for the next day.
- **peak gate q:** the most people bunched at any one island's gate line.

Idle player, seed 1:

```
day |  added | active | on-time | worst meter |  balance |   income |  upkeep | shut+open | moved | peak gate q | gates     | rent x
  1 |     3 |      3 |   98.6% |       96.7% |   21,363 |    2,572 |     988 |       |   896 |          25 | 22        | 
  2 |     3 |      3 |   98.6% |       95.7% |   23,577 |    3,492 |     988 |       |  1198 |          17 | 22        | 
  3 |     3 |      3 |   98.5% |       95.1% |   25,434 |    3,212 |     988 |       |  1142 |          21 | 22        | 
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
| `DESPERATE_SPEED_MUL` | 0.7 | 0.3 | At 0.5-0.7, going without a toilet cost about as much as using one, since a visit takes 10+ game minutes at walking pace. At 0.3 the roomy station gained 6.6 points from its toilets (5.4 now that missed passengers are rebooked with a new deadline). |
| `DRIFT_PER_TILE` | 0.25 | 0.5 | As above: a desperate walker's detours are what toilets save. |
| `FATIGUE_SPEED_MUL` | (new) | 0.85 | The ruled fatigue: someone tired and not sitting walks slower until they have sat down. |
| Toilet need rate (needs.ts) | 1/180 | 1/60 per minute | Enough passengers need a toilet during their visit for toilets to matter. |
| `TOILET.serveMin` (facilities.ts) | 3 | 1 | A visit has to beat going without, which is the floor the ruling set. |
| `SHRINK_RATE` | 0.7 | 0.8 | The daily rule's bar too. At 0.7 summer weekdays at 72-80% never closed a platform and lost money every day; a refund of 12 against a fare of 4 breaks even near 75%, before arrivals (who pay no fare) are counted. |
| `SHRINK_DAYS` | (new) | 1 | One failing day closes a platform. At 2 the first summer week cost 13,000-39,000 before anything closed. |
| Summer holiday factor (clock.ts) | 1.3 | 1.15 | At 1.3 even 8 active platforms ran summer weekdays at 65-80%. |

Unchanged on purpose: `GATE_INTERVAL_SEC` 0.25, `GROW_RATE` 0.9, `COOLDOWN_MIN` 3,000 and `REFUND` 12.

- **`GATE_INTERVAL_SEC` 0.25:** it already gives queues at the busiest island with 2 gates. 0.35-0.45 still passed the 2-gate bar but jammed islands that had all 5 gates open.
- **`GROW_RATE` 0.9:** with the long sustain, 0.93-0.95 left the autoplay player growing only on weekends.

Prices, upkeep, starting cash, the refund and the fare bonus are also unchanged. A refund of 8-10 kept the summer positive too, but left the autoplay player with 100,000+ by September, and its different spending moved the growth days. Cheaper floor and a bigger fare were tried but not needed once the footbridge route moved to 12 platforms.

Sample-size floors in tests (">200 outcomes in 6 h") now scale with `SPAWN_PER_MIN_PER_PLATFORM` (`scaledByDemand` in `tests/sim/helpers.ts`). The growth, rent and gate tests take their values from the constants, so retuning does not break them. On-time bars were not loosened.

## Needs: what matters where

- **Whole day, in a roomy station** (8 platforms, every gate open, an 8-row hall, five hall toilets plus a toilet and seating on each island): toilets and seating are worth 5.4 points of on-time rate (90.2% against 84.9%, seeds 1-3).
- **Peak hours: toilet placement is the challenge.** At a weekday peak a badly placed toilet can cost more than it saves.
  - A toilet visit takes 10-15 game minutes at walking pace.
  - Queues that cross the concourse or a gate line add to the crush.
  - A toilet on the concourse makes island passengers cross the gates twice more. With only 2 gates per island, concourse toilets lowered the whole-day rate by 5 points.
  - The fix is the player's: put toilets near where needs arise, out of the main flow, and open the gates.
- **Seating:** about neutral for on-time. It helps tired passengers who are waiting, and they board anyway. Its value is in fatigue for passengers who sit down before walking on.
