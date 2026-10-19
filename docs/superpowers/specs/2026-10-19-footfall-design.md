# Footfall: game design

Date: 2026-10-19
Status: approved by the user, 2026-10-19

## 1. Intent

Footfall is a single-player management game about moving people through a public building. You start with a small railway station seen from above, as an architectural plan, and keep passengers flowing to their trains while you earn money from the shops you let. Over many sessions the station grows, a subway is dug beneath it, and finally an airport is added.

The fun is the tension between **money** and **flow**. Shops pay rent, but their queues spill into corridors and block people. The player constantly trades income against congestion, and fixes trouble spots as rush hour builds.

The game **never ends in failure**. Bad play makes the building shrink (platforms and gates close, fewer people come); good play makes it grow. The player wants growth, so that is the pressure.

## 2. Goals, non-goals, anti-goals

**Goals**
- A calm-looking, readable plan view where crowding is visible at a glance.
- A satisfying loop: watch, spot the jam, build or rearrange, see it clear.
- A long arc across play sessions: station, then subway, then airport.
- Visible vehicles: trains and planes arrive, crowds get off, crowds get on.
- A living clock: rush hours each weekday, a different shape at weekends.

**Non-goals (for now)**
- Multiplayer, accounts, online leaderboards.
- Phones and touch. Desktop browser with a mouse is the target. (The canvas has a phone board; that is a later idea, not this build.)
- Building every stage at once. All six stages are in the game (§10, §10a), but the build order is station first, playable end to end, then each stage in turn. The code should make adding a venue mostly new data and a few venue-specific rules, not a rewrite.
- Sound and music (nice later, not required).

**Anti-goals (a failure even if it works)**
- A game-over screen for crowding. Crowding only makes things worse, never ends the game.
- A cluttered, colourful "city builder" look. It must stay the flat plan look of the canvas.
- Passengers moving on rails/scripted paths that ignore the building. Walls, queues and crowds must genuinely change where and how fast people walk.

## 3. Visual language

Taken from the user's Footfall concept canvas, https://claude.ai/artifact/EN5NXXf1Z3fFECEs28E9MA (boards "Visual language", "Gameplay · Harbour Street station", "End of day"). Its HTML boards are the reference for piece shapes, HUD layout and crowding glows; match them.

- **Plan, not map.** Flat shapes, few colours, one bad thing at a time in red.
- **Palette**

  | Name | Hex | Use |
  |---|---|---|
  | Ground | `#ECE8E1` | outside the building, page background (dot grid) |
  | Floor | `#F8F6F2` | walkable floor |
  | Wall | `#23262B` | walls, gates, fixtures |
  | Track | `#CBC5BA` | rail track, escalator treads |
  | Night | `#14171C` | dark panels |
  | Circle | `#2F6FDB` | passenger type |
  | Triangle | `#E8772E` | passenger type |
  | Square | `#14907F` | passenger type / retail |
  | Diamond | `#E5B72A` | passenger type |
  | Alert | `#C4342C` | crowding rings, missed connections, money going red |
  | Ink | `#1E2126` | text; secondary text `#585D65` |

- **Type:** Schibsted Grotesk (UI, headings), IBM Plex Mono (numbers, clock, money). Google Fonts.
- **People are small shapes; shape carries meaning, colour backs it up**, so the board reads in greyscale and for colour-blind players.
- **Crowding states:** calm → busy → crowded (orange glow, people slow down) → jam (red glow plus a ring that fills while the jam lasts). In this game a full ring does **not** end the day, and it does not feed the service meter directly (§9: only the on-time rate does); it is a warning that people are about to be late.
- **Pieces** look as on the canvas: wall (thick dark bar), rail (dotted line), ticket gate (posts with gaps), escalator (tread lines, one way), stairs (rungs, two way), sign (dark rounded square with arrow).
- HUD as on the gameplay board: venue name and headline number top left, clock + speed buttons (pause / play / fast) top right, tool rail along an edge.

## 4. Core loop

1. Passengers enter through entrances (from the street) or step off vehicles.
2. Each has a goal: catch a specific departure, or leave the building. Some also want something on the way (a shop, a toilet, a seat).
3. They walk the building, slowed by crowds, queues and the routes you built.
4. Departing passengers who reach their platform/gate before boarding closes earn a **fare bonus**. Those who miss it cost a **refund**.
5. Shops take money from passers-by who stop; you receive **a percentage of their takings as rent**.
6. You spend money extending the floor, zoning retail, seating and toilets, and placing walls, signs and connections.
7. Service quality over time decides whether the building **grows or shrinks** (§9).

## 5. Time

- **One game day ≈ 10 real minutes** at normal speed (one game minute ≈ 0.42 s). A week ≈ 70 minutes.
- Speeds: pause, normal, fast (×3 suggested).
- **Length of the whole game:** the user wants the full arc (first station to a 48-gate airport) to take "a week of play". Read as **about 10–15 hours of play in total (my reading)**, spread over a week of sessions. Tune growth speed and prices to that: roughly subway by hour 3–4, airport by hour 6–8, exhibition centre and mall during the airport's growth, full airport and the stadium by hour 12–15. Growing the later venues to full size extends play beyond that (my call).
- **Squashed calendar (my call):** each game week stands for one month, so a game year is 12 game weeks (about 14 hours) and the whole arc is roughly one year. Days keep their weekday/weekend pattern; the clock also shows the month (`Tue 08:42 · July`). Summer holidays fill the July and August weeks; Christmas peaks in the second half of the December week. The game starts in March so the player meets a summer before the airport opens.
- Clock shows day and time, e.g. `Tue 08:42`, plus a label for the period ("Morning peak").
- **Demand curve (shape, numbers tuned by builder):**
  - Weekdays: morning peak ~07:00–09:30, evening peak ~16:30–19:00, moderate midday, low late night.
  - Friday evening is the busiest time of the week.
  - Weekends: flatter, smaller peaks late morning and afternoon; more leisure travellers, who are likelier to shop and spend more.
  - Night (~01:00–05:00): near empty; services thin out.
  - **Holidays:** extra traffic on top of the daily and weekly shape during the summer holidays and around Christmas, with more leisure travellers and luggage (so more lift and buggy users). The calendar shows when one is coming so the player can prepare.
- Day boundaries are not a stop: the game runs continuously. (The canvas's "end of day, pick an upgrade" screen is **not** in scope; growth happens through the service meter instead. Builder may show a small end-of-day summary toast with people moved, on-time %, money.)

## 6. Passengers

- **How a person looks (user's choice):** shape and colour together say **where they are going**; the fill says **what kind of journey** it is. Both still read in greyscale.
  - Where to:
    - Circle, blue: a **train** (mainline platform).
    - Triangle, orange: the **subway**.
    - Hexagon, purple (`#7B5CD6` suggested; builder may tune to match the palette's chroma and pass contrast on Floor): a **flight**.
    - Diamond, yellow: the **street** (an exit).
  - Kind of journey:
    - Solid: **departing** (came in from the street).
    - Outline only: **arriving** (stepped off a vehicle).
    - Half-filled: **connecting** (stepped off one vehicle, catching another). Shape and colour show the vehicle they're catching next.
  - Square, teal: shops and retail units, as on the canvas. A person stopped on an errand keeps their own shape.
- **One end goal each:** every person has exactly one final destination with a time, e.g. "Catch the 08:51 to Leeds, Platform 4", "Flight BA214, Gate 12, boarding closes 14:05", "Leave by the Quay Lane exit", and later "Seat in Block C, kick-off 15:00". Arriving passengers' end goal is an exit or a connection.
- **Everyone is given a fair chance.** When a person appears, the game works out how long their end goal takes to reach **walking unimpeded through the building as the player has built it** (best route, empty corridors, using movers, no errands). Their deadline is that time plus some spare time:
  - Spare time is spread so some people are very early (could shop, eat and sit down) and some have just enough (no spare time for errands or jams).
  - So a missed deadline is always caused by the building: crowds, queues, poor routes, missing facilities, or a disruption. Never by an impossible deadline.
  - If the player rebuilds while someone is on their way and makes their trip longer, that is on the player (deadlines are not recalculated).
- **Three kinds of journey:**
  - **Departing:** comes in from the street and catches a train, subway or flight.
  - **Arriving:** steps off a vehicle and heads for an exit. Their end goal names where they're going beyond it (home, hotel, work) and has a deadline for reaching that exit, set the same fair way.
  - **Connecting:** steps off one vehicle and catches another, e.g. train → flight, subway → train, train → subway. The connection's departure time is chosen so the transfer is possible unimpeded. Train-to-plane connections only exist once the airport opens.
- **Temporary goals on the way:** hungry, thirsty, tired, needs the toilet, wants to browse, needs a phone charge. Each is a level that rises over time (faster while waiting or after a long journey); past a threshold it becomes the person's current errand. They may have several at once, and they abandon an errand when their end goal is getting too close in time.
- **Click a person to inspect them:** a card shows their end goal and time (and how long they have left, red when they're at risk of missing it), their current errand, and a small bar per need (hunger, thirst, tiredness, toilet, …). The route they plan to take is drawn on the plan as a line to where they're heading now, then on to their end goal. The card follows them until closed. Hovering shows a one-line version.
- **Needs and where they are met** (chance-based, more likely when waiting longer or travelling further):
  - Shop: stops at a shop they pass if the queue isn't too long.
  - Toilet: must find a toilet. Uses signs and what they can see; if none is found they wander, slow down, and grow likelier to miss their connection.
  - Seat: when waiting more than a few minutes for a departure, they look for seating; with none, they stand on the concourse and add to crowding.
- **Mobility:** a share of passengers (luggage, pushchairs, wheelchairs) can only use **lifts** between levels. This is why lifts matter. (My call.)
- **What passengers know (my call):** everyone knows the way to platforms, gates and exits (one shared route field per destination). They do **not** know where toilets, seating and shops are: they find those by sight (a few tiles around them) or by following signs. So signs are the tool for facilities, not for platforms.
- **Movement:** grid-based pathfinding across walkable tiles, respecting walls, one-way escalators, gates. Walking speed drops with local density. Queues form physical lines of people on the floor that others must route around.

## 7. Vehicles and timetables

- **Trains:** arrive at a platform, doors open, arriving passengers alight in a crowd and head for exits/connections, waiting passengers board, doors close, it departs **on time** regardless of who is still on the way. Each platform shows its next departure and a countdown.
- **Subway:** as trains, shorter dwell and higher frequency, smaller per-train crowds.
- **Planes:** taxi to a gate, unload, then board. **Boarding closes a few minutes before departure**; arriving at the gate after that is a miss. Departures are fewer and bigger.
- Timetable frequency follows the demand curve (more services at peak).
- Connections: some arriving passengers transfer (train → subway, subway → flight, etc.), which is what links the three levels.

## 8. Economy

- **Starting cash** enough for a few small builds (builder tunes).
- **Income**
  - Rent: a percentage of each shop's takings. A shop only earns when people buy, so placement matters.
  - **Rent by location (user's idea, added 2026-10-19):** each shop's rent share is scaled by how busy its spot was the day before (people passing within a few tiles, each counted once a day). A quiet spot pays less than the base share, a busy one up to about double. It is recalculated at midnight and shown in the shop's panel ("Busy spot: rent ×1.6"). Busy spots therefore earn more but also clog more.
  - Fare bonus per passenger who makes their departure.
- **Costs**
  - Missed-connection refund per passenger who misses.
  - Extending floor: price per tile, shown live while dragging; red if unaffordable.
  - **Underground costs far more:** extending floor on the subway level is a large multiple of the station's price (suggest ×4–5, it has to be dug out), and zoning and movers there cost more too. Underground space should feel precious, so the player squeezes the subway rather than sprawling it.
  - Zoning (retail fit-out, seating, toilets): price per tile.
  - Walls, signs, escalators, stairs, lifts: fixed prices.
  - **Maintenance:** a running cost per tile of everything built, charged once per game day, at a different rate per kind (e.g. plain floor cheapest, toilets dearest; movers like escalators and travelators have their own upkeep). Shown as "running costs per day" in the HUD.
  - Removing refunds half (my call).
  - Evicting a tenant costs a fee and leaves the unit empty for a while (my call).
- **The economy serves crowd management, not the other way round.** Money is the pressure that makes you choose; the game's attention, UI and moment-to-moment play stay on keeping people moving. Keep finance screens minimal: a balance, today's income and costs, and the live price while building.
- Money can't go below zero through building (builds are refused). Refunds can push it negative; then building is blocked until it recovers. No other penalty (no game over).

## 9. Growth and shrinkage (the service meter)

- **The on-time rate drives everything.** One **service meter per level** (station, subway, airport): the share of that level's passengers who reached their end goal on time (caught their train, made their flight, left by their exit) over a rolling window (suggest the last ~2 game hours). Nothing else feeds it; crowding matters only because it makes people late.
- Each level grows and shrinks on its own meter:
  - Sustained good on-time rate **adds a new platform or gate** on that level, or **reactivates** an inactive one first.
  - Sustained poor on-time rate makes one **inactive**.
- **A platform or gate, once added, is never removed.** An inactive one stays on the plan, greyed out, with no services and no passengers sent to it; the floor and shops around it stay. It comes back into use when the on-time rate recovers. At least the level's starting count always stays active.
- **Progress counts platforms and gates added, not active (my call),** so the subway opens at 10 rail platforms added, and the airport at 18 + 6. A stage, once opened, never closes or locks again.
- **Platforms come in pairs (island platforms, user's idea, added 2026-10-19):** each island is one shared walkway with a track on each side; the odd platform is the left track, the even platform the right. Platforms 1 and 2 share island 1, and so on: 18 platforms are 9 islands. Growth still opens one platform at a time; the island (walkway, both track beds, foot) appears with the first platform of its pair, and the second platform's track comes into use when it opens. Waiting passengers stand on their own platform's half of the walkway.
- **Wider islands with a usable centre (user's idea, added 2026-10-19):** each island walkway is 5 squares wide. The row beside each track is the platform edge, where passengers wait and board; nothing can be built there. The middle 3 squares can take seating, toilets, small shops and signs, as long as the island stays passable (the normal "would cut off" check). The gate line at the island's foot is 5 wide, so an island can have up to 5 gates.
- **Ticket gates (user's idea, added 2026-10-19):** a line of ticket gates crosses the foot of each island, between the concourse and the walkway. Every passenger going on to or off the island passes through a gate; each gate lets one person through at a time and slowly, so queues form on both sides at peak. An island opens with 2 gates and the rest of the line closed off; the player can buy more gates (up to the walkway's width) with the Gate tool, at a price and a daily upkeep. Gate crossing time is part of the unimpeded walk used for fair deadlines; the queue in front of a gate is not.
- New platforms/gates appear in **fixed spots chosen by the game** along the track edge or apron; the player builds the station around them. The game may also add the floor directly in front of a new platform so it is reachable (builder's call).
- Headline number top left is "people moved today"; growth stage shown near it (e.g. "Rail 7 / 18").

## 10. Progression

| Stage | Trigger | Starts with | Grows to |
|---|---|---|---|
| Railway station (ground level) | game start | 2 platforms (my call) | 18 platforms |
| Subway (below ground) | station reaches **10** platforms | 2 platforms | 6 platforms |
| Airport (its own area/level) | station **18** and subway **6** | 2 gates | 48 gates |

- **Subway level:** a separate floor view below ground. The player must connect the levels with **escalators** (fast, one way), **stairs** (slow, two way) and **lifts** (two way, few people at a time, the only option for mobility-limited passengers). Switching level is a tab or key; connectors show on both levels.
- **Airport:** its own area reached from the station/subway (e.g. by a link corridor or level), with gates on an apron. Exact layout left to the builder, within these rules:
  - **Every departing flyer goes check-in → security → gate, in that order** (user's rule). Train-to-plane and subway-to-plane connections do too.
  - **Check-in:** desks the player places in the landside hall; each desk serves one person at a time, so queues form. More desks cost money and upkeep.
  - **Security is an enforced bottleneck:** a fixed line across the terminal separating landside from airside. The only way through is security lanes placed **on that line**. The player can add lanes (expensive, with high upkeep) but can never route around the line. Each lane has a slow, steady throughput, so its queue is the main thing to manage at peak.
  - **Landside vs airside:** shops, seating and toilets can go on either side; **duty free only airside**. People who are through security can't go back.
  - **Arrivals (my call):** arriving flyers skip check-in and security and leave airside by a separate one-way arrivals route through the security line (no queue), so they don't cross the departure queues if the player lays it out well.
  - **Plane-to-plane transfers (my call):** stay airside and go straight to their next gate.
- Each stage starts with a starter layout (walls, entrances, platforms/gates, a small concourse) so the player isn't facing an empty grid.

## 10a. Later stages (venues after the airport)

The game keeps growing beyond the airport. Each venue is its own area linked to the transport hub by a walkway (and, where it makes sense, its own subway platform), and brings its own ebb and flow of people. Their visitors use the same rules: one end goal with a time, errands on the way, fair deadlines, and the venue's own on-time meter driving its growth.

| Stage | Trigger (my call) | Starts with | Grows to (my call) |
|---|---|---|---|
| Exhibition centre | airport reaches 24 gates added | 2 halls | 12 halls |
| Shopping mall | airport reaches 36 gates added | 2 anchor stores | 8 anchor stores |
| Sports stadium | airport reaches 48 gates added | 4 entry gates | 16 entry gates (capacity grows with them) |

Triggers are spread through the airport's growth so later stages add variety while the airport is still growing. The 10–15 hour target (§5) now covers reaching the stadium; growing the later venues to full size extends play beyond it.

- **Exhibition centre (user's layout):** a **fixed-width, wide central corridor** with **large halls on either side**. The player builds inside the corridor (shops, food, seating, toilets, movers), not in the halls. The corridor **gets longer as halls are added**, each new pair of halls extending it. Flow: quiet most days, then large surges when an event's doors open and close (a calendar of events, shown ahead like holidays), and a lunchtime rush to food. End goal for visitors: "Hall 3, Bike Show, doors 10:00".
- **Shopping mall (my call on layout, not yet specified by the user):** a two-floor atrium with anchor stores at its ends; the player zones the smaller units, seating and toilets between them and connects the floors. Steady all day, busiest at weekends, late openings and the Christmas weeks. Most visitors come to shop, so retail placement and rent matter most here. End goals are "leave by 17:30 to catch the 17:42", i.e. their departure from the hub.
- **Sports stadium (user's layout):** a **giant oval** for the stands and pitch, drawn as a fixed shape the player can't build in. **Entry/exit gates sit around the oval.** The player can build shops, toilets, seating, rails and signs in the **ring of space around the oval, which is deliberately tight**, hemmed in by obstacles. Flow: nothing for days, then a match: a slow build-up before kick-off, nearly empty during play, half-time rush to toilets and food, then a sudden flood at full time all heading for trains and the subway at once (the canvas's "Northgate Stadium at full time" board). End goal for fans: "Seat in Block C, kick-off 15:00", and after the match a train home.

## 11. Building tools

All area tools work by **click and drag a rectangle on the tile grid**, with a dashed preview, size in tiles and live cost.

- **Extend floor.**
- **Retail zone (tenants move in).** The player drags a retail unit and pays the fit-out. After a short wait a tenant takes it, chosen by who walks past:
  - Station and subway: food and drink, newsagent, phone charging, electronics.
  - Airport: duty free, bars, cafés, restaurants.
  - Commuter-heavy footfall favours coffee/newsagent; leisure-heavy favours electronics, bars, duty free.
  - Each tenant type has its own spend per customer and typical queue length. Larger units serve faster.
  - The player can evict a tenant to get a different one (fee, empty period).
- **Seating zone.** Pick, drag, pay per tile; capacity grows with size.
- **Toilet block.** Pick, drag, pay per tile; more tiles serve more people at once.
- **Wall, rail (queue barrier), sign** (points people towards toilets, seating and shops), **remove**.
- **Gate:** click a closed-off tile in an island's gate line to open a new ticket gate there (removing one closes it again, half refund).
- **Movers** (the main tools for crowd management, unlocked over time):
  - **Stairs:** cheap, slow, two way, between levels.
  - **Escalator:** fast, one way, between levels.
  - **Lift:** two way, few people at a time; the only way between levels for mobility-limited passengers.
  - **Travelator (moving walkway):** a one-way strip on one level that speeds up long walks; people can walk on it too.
  - **Buggy service (golf carts):** the player places a buggy stop and the route it serves; carts carry mobility-limited passengers over long distances (mainly the airport). Limited seats, so a queue can form at the stop.
- **Ground you can't build on, and plenty of it:** each level's map is crowded with fixed obstacles that can't be built over, so the buildable space is irregular rather than an open field. They create pinch points and longer walks, and the player must route around them. Where they sit is part of each stage's starter map.
  - Station level: listed buildings, roads and a bus lane, a river or canal, neighbouring property, the track bed.
  - Subway level: structural pillars, foundations of the buildings above, sewers and utility tunnels, other lines' tunnels, bedrock.
  - Airport: runways and taxiways, the control tower, fuel depots, car parks, roads.
  - Obstacles should be spread so that expanding in any direction soon meets one, and some gaps between them are only a few tiles wide (natural pinch points).
- Placement is refused where it would block a platform edge, entrance or the only route to somewhere (builder decides how strict).

## 12. Disruptions

At random intervals (roughly once or twice a game day, more at higher stages):
- **Rail line closure:** some platforms stop running for a period; their passengers wait, then many reroute.
- **Subway track failure:** the subway stops; transfers pile up at the connection points.
- **Bad weather:** flights delayed or grounded; gate areas fill.
- A banner announces each one with an expected duration. Waiting crowds stress seating, toilets and floor space. Missed connections caused directly by a disruption are refunded at a reduced rate (my call, so disruptions sting but don't feel unfair).

## 13. Saving

Autosave to browser storage every game hour and on pause/close; one save slot; "New game" asks before overwriting. A save from before the island-platform change can't be loaded (the map changed); the game says so and starts a new one.

## 14. Technology (my calls)

- Browser game, TypeScript, Vite, drawn on an HTML `<canvas>` (2D), HUD and tool rail in plain DOM over the canvas.
- No game engine required; a fixed-timestep simulation separate from rendering so fast-forward is just more steps per frame.
- Lives in `~/Code/footfall`, its own git repo, unrelated to Grantmaker.
- **Browser, shared by link (user's decision, Unity considered and declined).** A static site with no server; where it is hosted is left to the builder. Wrapping it as a desktop app for Steam is a possible later step, so keep the simulation free of browser-only APIs where that's cheap.
- **First build step is a performance test:** 5,000 people walking a large floor with obstacles at ×3 speed, using shared route fields and a crowd grid, measured in Chrome on the user's machine. If it can't hold a smooth frame rate, switch drawing to WebGL and/or move the simulation to a Web Worker before anything else depends on it.
- Unit tests (Vitest) for the simulation rules: pathfinding, queues, economy, service meter, progression triggers.

## 15. Left to the builder

- All numbers: prices, rent %, fare bonus, refund, demand curves, walking speeds, density thresholds, timetable frequencies, meter window and thresholds.
- Grid size and tile scale; camera pan/zoom.
- Pathfinding details, within §6's rule (shared route fields to platforms, gates and exits).
- **Scale (my call):** plan for a few thousand people on screen at airport peak, so use route fields and spatial lookup for density from the start. If that is still too slow, one shape may stand for several people at later stages.
- The airport's exact layout and how it connects.
- How strict placement validation is.
- The build order (suggest: station only first, playable end to end, then subway, then airport, then exhibition centre, mall and stadium).
