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

Each move starts the `COOLDOWN_MIN` (2,400 minute) cooldown. A platform, once added, is never removed: closing one cancels its services yet to arrive (a train already standing still departs) and rebooks their passengers.

## The first summer

Summer holidays fill the July and August weeks (game days 29-42). Weekday demand is `x1.15` (it was `x1.3`).

With `x1.3`, no daily rule and `SHRINK_RATE` 0.7, the autoplay station went into summer at 11 platforms, ran weekdays at 50-64% on time with worst 2-hour readings of 19-31%, and lost about 20,000 a weekday: -136,000 to -210,000 by game day 38-40 and still falling into September. Weekends kept growing it (platform 12 opened in July).

Now, seeds 1-3: the daily rule closes 1-2 platforms in the first summer week and another in the second; weekdays run 74-93% on time; the balance never goes below zero (lowest summer balances 4,370 / 12,711 / 5,155). Platforms reopen on the weekends and after the holidays.

## Targets (final run, seeds 1-3)

Three targets were set by controller rulings after the summer work (see "Why the cooldown is 2,400" below): the 6-platform window is days 7-15 (it was 9-15), the idle player may reach 4 platforms in 3 days (it was 2-3), and `COOLDOWN_MIN` is 2,400.

| Target | Measured | Result |
| --- | --- | --- |
| Idle player stays at 2-4 platforms over 3 game days | 4 / 3 / 4 | PASS |
| Autoplay reaches 6 platforms in game days 7-15 | game day 7, all seeds | PASS |
| Autoplay reaches 10 platforms in game days 18-24 | game day 21, all seeds | PASS |
| Autoplay money stays positive after day 2, up to the summer | lowest 1,244 / 1,753 / 1,551 | PASS |
| Typical concourse shop near rent x1.0 (median from day 4 up to the summer) | x1.03 / x1.05 / x1.01 | PASS |
| Balance never below -20,000 over 49 days | lowest 1,244 / 1,753 / 1,551 | PASS |
| Balance positive within 7 days of the summer's end | positive throughout | PASS |
| Platforms close in the summer | game days 29, 30, 36 / 29, 33, 36 / 29, 30 | PASS |
| And reopen afterwards | first on game day 35, all seeds | PASS |
| Whole day, roomy station: toilets and seating at least 5 points better | 90.2% with, 84.9% without (+5.4) | PASS |
| `npm test` bars (gates, needs, on-time; idle at most 3 platforms after 2 days) | unchanged and passing | PASS |

### Why the cooldown is 2,400

A passenger who misses their train is now rebooked like anyone whose service is cancelled, with the new service's departure as their deadline. Before, they kept the deadline already past, so they ran no errands and left seats and queues. With real time to spare they now run errands, which makes weekdays at 8-9 platforms harder: 88-92% on time rather than 91-96%. The weekday growth the autoplay player used to get at 8 platforms then rarely holds 480 minutes at 0.9, and at 3,000 the 10th platform came on game day 21 / 28 / 49.

Levers tried, 49 days, seeds 1-3:

| Change from the final settings | 6 platforms | 10 platforms | Lowest balance |
| --- | --- | --- | --- |
| None (final, `COOLDOWN_MIN` 2,400) | day 7 | 21 / 21 / 21 | 1,244 / 1,753 / 1,551 |
| `COOLDOWN_MIN` 3,000 | day 9 | 21 / 28 / 49 | 3,047 / 1,238 / 2,353 |
| `COOLDOWN_MIN` 2,800 | day 8 | 28 / 21 / 28 | all positive |
| `COOLDOWN_MIN` 2,640 | day 8 | 21 / 20 / 49 | all positive |
| `COOLDOWN_MIN` 3,000, `GROW_RATE` 0.88 | day 9 | 21 / 21 / 28 | all positive |
| `COOLDOWN_MIN` 3,000, `SHRINK_RATE` 0.75 | day 9 | 21 / 28 / 28 | -12,079 / 1,238 / -1,865 |
| `COOLDOWN_MIN` 3,000, `SHRINK_DAYS` 2 | day 9 | 21 / 28 / 28 | -39,006 / -15,264 / -13,093 |
| `COOLDOWN_MIN` 3,000, `SUSTAIN_MIN` 420 | day 8 | 28 / 28 / 21 | all positive |

Only a cooldown of 2,400 brought 10 platforms by day 24 on every seed. It also brings 6 on day 7, and the idle player (which builds nothing) grows every 2,880 minutes, cooldown plus sustain, so it reaches 4 platforms on game day 3 on seeds 1 and 3. Hence the two widened windows.

## Final table: autoplay, seed 1

Game days are numbered from 1. **shut+open:** platforms closed (-) and reopened (+) that day.

```
day |  added | active | on-time | worst meter |  balance |   income |  upkeep | shut+open | moved | peak gate q | gates     | rent x
  1 |     3 |      3 |   99.6% |       97.7% |    3,047 |    2,532 |   1,346 |       |   890 |          19 | 52        | 
  2 |     3 |      3 |   99.7% |       97.8% |    5,093 |    3,514 |   1,346 |       |  1196 |          16 | 52        | 0.62
  3 |     4 |      4 |   99.6% |       97.7% |    2,529 |    4,074 |   1,448 |       |  1364 |          22 | 55        | 0.63
  4 |     4 |      4 |   99.6% |       98.0% |    5,020 |    4,299 |   1,448 |       |  1493 |          19 | 55        | 0.64 0.87
  5 |     5 |      5 |   99.1% |       97.4% |    5,822 |    4,998 |   1,840 |       |  1738 |          24 | 552       | 0.72 1.04
  6 |     5 |      5 |  100.0% |      100.0% |    8,660 |    4,687 |   1,840 |       |  1452 |          16 | 552       | 0.62 0.88
  7 |     6 |      6 |  100.0% |      100.0% |    1,244 |    4,703 |   2,014 |       |  1504 |          14 | 552       | 0.65 0.91
  8 |     6 |      6 |   99.0% |       96.5% |    1,766 |    6,762 |   2,099 |       |  2283 |          29 | 552       | 0.94 1.37 0.60
  9 |     7 |      7 |   96.6% |       88.6% |    4,361 |    7,308 |   2,475 |       |  2452 |          34 | 5522      | 0.98 1.49 0.60
 10 |     7 |      7 |   94.7% |       79.9% |    7,215 |    7,723 |   2,490 |       |  2678 |          48 | 5532      | 1.02 1.67 0.71
 11 |     8 |      8 |   96.6% |       87.0% |    4,296 |    8,410 |   2,547 |       |  2824 |          34 | 5532      | 1.07 1.79 0.82
 12 |     8 |      8 |   91.1% |       75.7% |    7,571 |    9,278 |   2,547 |       |  3229 |          76 | 5532      | 1.26 1.92 0.91 0.69
 13 |     9 |      9 |  100.0% |       99.6% |    8,503 |    7,113 |   2,962 |       |  2312 |          24 | 55422     | 0.92 1.46 0.73 0.60
 14 |     9 |      9 |   99.7% |       98.5% |   12,919 |    7,861 |   2,962 |       |  2542 |          24 | 55422     | 1.01 1.60 0.89 0.70
 15 |     9 |      9 |   87.4% |       65.3% |   13,192 |    9,378 |   2,977 |       |  3468 |          77 | 55522     | 1.30 2.00 1.18 0.93
 16 |     9 |      9 |   86.1% |       60.9% |   14,115 |    9,791 |   2,977 |       |  3536 |          91 | 55522     | 1.42 2.00 1.03 0.77
 17 |     9 |      9 |   85.3% |       63.8% |   14,133 |    9,579 |   2,977 |       |  3612 |          86 | 55522     | 1.44 2.00 1.03 0.77
 18 |     9 |      9 |   85.2% |       62.1% |   14,451 |    9,830 |   2,977 |       |  3594 |         100 | 55522     | 1.39 2.00 1.07 0.80
 19 |     9 |      9 |   81.3% |       55.1% |   12,930 |    9,830 |   2,977 |       |  3684 |         122 | 55522     | 1.43 2.00 1.19 0.87
 20 |     9 |      9 |   99.9% |       97.3% |   17,319 |    7,716 |   2,977 |       |  2493 |          20 | 55522     | 0.94 1.56 0.86 0.71
 21 |    10 |     10 |   99.6% |       97.9% |   17,948 |    7,627 |   3,034 |       |  2445 |          23 | 55522     | 0.95 1.60 0.86 0.73
 22 |    10 |     10 |   80.9% |       55.7% |   16,201 |   10,071 |   3,034 |       |  3836 |         118 | 55522     | 1.43 2.00 1.46 1.23 0.60
 23 |    10 |      9 |   75.4% |       44.6% |   10,091 |    9,625 |   3,064 |    -1 |  3905 |         125 | 55542     | 1.39 2.00 1.62 1.41 0.60
 24 |    10 |      9 |   83.2% |       53.5% |    8,600 |    9,458 |   3,079 |       |  3580 |         122 | 55552     | 1.30 2.00 1.48 1.27 0.60
 25 |    10 |      9 |   88.0% |       71.3% |    9,943 |    9,656 |   3,079 |       |  3476 |          89 | 55552     | 1.33 2.00 1.25 0.99 0.60
 26 |    10 |      9 |   80.0% |       54.8% |    7,711 |    9,753 |   3,079 |       |  3692 |         116 | 55552     | 1.34 2.00 1.39 1.14 0.60
 27 |    10 |      9 |   99.7% |       98.1% |   12,374 |    8,036 |   3,079 |       |  2543 |          20 | 55552     | 0.99 1.64 0.87 0.74 0.60
 28 |    10 |     10 |   99.7% |       98.6% |   15,743 |    8,435 |   3,111 |    +1 |  2705 |          23 | 55552     | 1.09 1.67 0.84 0.68 0.60
 29 |    10 |      9 |   75.2% |       47.6% |   10,310 |   11,146 |   3,111 |    -1 |  4511 |         162 | 55552     | 1.62 2.00 1.47 1.07 0.60
 30 |    10 |      8 |   74.4% |       45.9% |    4,656 |   10,477 |   3,111 |    -1 |  4235 |         170 | 55552     | 1.55 2.00 1.47 1.22 0.60
 31 |    10 |      8 |   83.9% |       55.9% |    4,439 |   10,154 |   3,111 |       |  3758 |         124 | 55552     | 1.40 2.00 1.38 1.17 0.60
 32 |    10 |      8 |   87.7% |       66.2% |    5,874 |   10,090 |   3,111 |       |  3688 |          79 | 55552     | 1.39 2.00 1.23 1.00 0.60
 33 |    10 |      8 |   81.9% |       55.0% |    4,370 |   10,055 |   3,111 |       |  3869 |         141 | 55552     | 1.57 2.00 1.14 0.85 0.60
 34 |    10 |      8 |   99.7% |       94.9% |    9,256 |    8,092 |   3,111 |       |  2587 |          27 | 55552     | 1.01 1.53 0.72 0.60 0.60
 35 |    10 |      9 |   99.7% |       99.1% |   14,670 |    8,723 |   3,111 |    +1 |  2807 |          23 | 55552     | 1.17 1.63 0.83 0.64 0.60
 36 |    10 |      8 |   79.8% |       57.6% |   11,440 |   10,013 |   3,111 |    -1 |  4018 |         127 | 55552     | 1.65 2.00 1.42 1.21 0.60
 37 |    10 |      8 |   86.5% |       63.1% |   12,536 |   10,375 |   3,111 |       |  3803 |          95 | 55552     | 1.63 2.00 1.15 0.98 0.60
 38 |    10 |      8 |   89.6% |       70.6% |   14,980 |   10,068 |   3,111 |       |  3583 |          82 | 55552     | 1.52 1.96 0.90 0.71 0.60
 39 |    10 |      8 |   92.6% |       77.5% |   19,457 |   10,955 |   3,111 |       |  3759 |          69 | 55552     | 1.63 1.98 0.91 0.70 0.60
 40 |    10 |      8 |   82.7% |       61.6% |   18,444 |   10,087 |   3,111 |       |  3816 |          94 | 55552     | 1.59 2.00 1.06 0.86 0.60
 41 |    10 |      8 |   99.7% |       96.7% |   23,507 |    8,311 |   3,111 |       |  2660 |          21 | 55552     | 1.13 1.54 0.74 0.61 0.60
 42 |    10 |      9 |   99.7% |       98.4% |   28,609 |    8,427 |   3,111 |    +1 |  2746 |          27 | 55552     | 1.16 1.61 0.74 0.60 0.60
 43 |    10 |      9 |   88.1% |       65.7% |   28,791 |    8,883 |   3,111 |       |  3441 |          84 | 55552     | 1.49 1.93 0.95 0.76 0.60
 44 |    10 |      9 |   89.5% |       72.0% |   30,981 |   10,048 |   3,111 |       |  3573 |          74 | 55552     | 1.47 2.00 0.93 0.69 0.60
 45 |    10 |      9 |   89.4% |       71.4% |   33,292 |   10,088 |   3,111 |       |  3558 |          81 | 55552     | 1.53 1.97 0.83 0.63 0.60
 46 |    10 |      9 |   86.3% |       64.7% |   34,275 |    9,914 |   3,111 |       |  3547 |          91 | 55552     | 1.47 2.00 0.93 0.71 0.60
 47 |    10 |      9 |   85.5% |       55.8% |   33,827 |    9,393 |   3,111 |       |  3599 |         107 | 55552     | 1.52 2.00 1.02 0.79 0.60
 48 |    10 |      9 |   99.8% |       99.1% |   37,851 |    7,661 |   3,111 |       |  2489 |          20 | 55552     | 1.05 1.44 0.69 0.60 0.60
 49 |    10 |     10 |  100.0% |       99.2% |   42,709 |    8,101 |   3,111 |    +1 |  2525 |          22 | 55552     | 1.09 1.50 0.69 0.60 0.60
summer weekdays on time 74.4%-92.6%, lowest balance 4,370
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
  3 |     4 |      4 |   97.2% |       92.8% |   25,981 |    3,968 |     988 |       |  1361 |          18 | 22        |
```

## Constants changed

| Constant | Before | After | Why |
| --- | --- | --- | --- |
| `SPAWN_PER_MIN_PER_PLATFORM` | 0.3 | 0.18 | Demand per platform is 0.6x. Entrances A and B are fixed, so whole-station load grows with the platform count. At 1x the station jammed at the entrances beyond about 5 platforms; at 0.75x, once needs had a cost, weekdays at 6-7 platforms fell to 80-89%. |
| `ALIGHT_BASE` (timetable.ts) | 6 | 3.6 | Scaled with the spawn rate, so arrivals and departures stay in proportion. |
| `SUSTAIN_MIN` | 180 | 480 | Growth needs 8 good hours in a row, so a peak that goes badly blocks it that day. |
| `COOLDOWN_MIN` | 240 | 2400 | Paces growth to about one platform every 2 game days: 6 platforms on game day 7 and 10 on game day 21. It was 3,000 until missed passengers were rebooked with a new deadline (see "Why the cooldown is 2,400"); at 3,000 the 10th platform came on day 21 / 28 / 49. |
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

Unchanged on purpose: `GATE_INTERVAL_SEC` 0.25, `GROW_RATE` 0.9 and `REFUND` 12.

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
