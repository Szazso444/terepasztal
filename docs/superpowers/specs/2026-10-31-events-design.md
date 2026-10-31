# Events and situations

Author: Zsolt, with Claude. Date: 2026-10-31. Status: draft for the author's review. It changes no
code.

## 1. Goal and non-goals

Now and then something happens on the player's network, and the player decides what to do about it,
as in Stellaris. Events are a small part of the game: about 15 in a 10-hour game, 12 kinds in all.
None does much harm, each is worth a look, and anything that asks the player to act takes them to
the spot.

Not in this design:

- Age crises, or a separate set of events for each age. Every event can come in every age. Prices
  follow income, so they weigh about the same throughout.
- Strength by difficulty mode. All three modes get the same events.
- Events that close a line, or take money without the player choosing it.
- Tickets, banners or anything else from the gacha.

## 2. The author's decisions

| Question                | Answer                                                         |
| ----------------------- | -------------------------------------------------------------- |
| What events are for     | decisions, trouble and opportunities together, as in Stellaris |
| How much of the game    | a small part, and simple ("ennél jóval kevesebb")              |
| The choice              | as in Stellaris                                                |
| How much harm           | none may be very harmful, but each must be worth looking at    |
| Taken from Stellaris    | chains, special projects, discoveries; a situation log         |
| Not taken               | age crises                                                     |
| How an event hits track | through the health of track wear (#625), no second mechanism   |
| Action items            | a situation always takes the player to the spot in the game    |

The author first chose strength by difficulty mode. The ruling that none may be very harmful came
later and replaces it.

## 3. What the player sees

### Rhythm

- The first event comes on day 5 at the earliest. After that the gap is 7 to 13 days, 10 on average:
  40 minutes at 1x, so about 15 in the 150 days of a 10-hour game.
- The rule `eventRate` in Game tuning scales the rhythm: 0 turns events off, 1 is the default, 3 is
  the most.
- An event comes only where it makes sense: the season, the player's network and the towns decide
  (section 5). On a day when none fits, the next day tries again.
- After trouble the next event is not trouble.
- A kind does not come back within 40 days.
- A discovery comes when a chunk is bought, with a chance of 1 in 4. It is outside the rhythm.

### The Event window

A title, one picture, two or three lines of text and two or three choices, as in Stellaris. Each
choice shows what it costs and does. Its tooltip gives the exact numbers, made from the same data
the simulation applies, so the number shown is the number that happens.

- **The first choice is always free.** That makes "Pick the first choice for me" safe, and it means
  no event can bankrupt the player.
- A choice the player cannot pay for is grey, with the reason.
- An event with no choice has no window: it is news (section 6).
- Esc leaves the decision open. It stays a situation, and after 3 days the first choice takes
  effect.
- A row at the foot sets what to do with this kind of event: Ask and pause, Ask, keep running, Pick
  the first choice for me, Alert only. A link opens the notification settings.

### Situations

A small window, like the Stellaris situation log, with two parts. The clock keeps running.

- **To do:** one row for each open action item, with what to do and the time left. There are three
  sorts:

  | Action item | Row says                              | The row takes the player to                |
  | ----------- | ------------------------------------- | ------------------------------------------ |
  | Decide      | Flood at Szeged: decide               | the spot, and opens the Event window       |
  | Repair      | Repair 5 pieces of the Szeged line    | the stretch, flashed, with the Repair tool |
  | Deliver     | Take 120 stone to Szeged, 2 days left | the station, and opens its panel           |

- **Under it:** the effects running now and how long they last, then the log of past events. A row
  there with a place takes the player to that place too.

Every action item is also an icon in the alert bar and a pin on the map, and those lead to the same
place. An action item whose place has gone (a station demolished, the track taken up) closes itself.

## 4. How much harm

These are the limits, and tests hold every event to them (section 10):

- An event hits one place: a stretch of 3 to 6 track pieces, one town, or one chunk.
- A bad effect is at most -20 %, and lasts at most one season (24 minutes at 1x).
- Track only gets slow. It never closes, so no train stops because of an event. Track an event hit
  does not wear while its action item is open, and when the time is up it mends by itself
  (section 8).
- Money and goods go only on what the player picks.
- A late delivery earns nothing and costs nothing.

Dealing with an event pays: the paid or project choice gives back more than the damage takes.

## 5. The twelve events

"Income" is the average income per day over the last 4 days, at least `EVENT_MIN_INCOME`. A
project is a delivery by train with a deadline (section 7). Numbers are starting values for the
playtest.

### Trouble

| Id        | When and where                          | What happens                                  |
| --------- | --------------------------------------- | --------------------------------------------- |
| flood     | spring; track within 2 tiles of a river | 4-6 pieces slow, up to a season               |
| snowdrift | winter; track on hills or mountains     | 4-6 pieces slow for 2 days                    |
| landslide | not winter; track on a slope            | 3-5 pieces slow, up to a season               |
| drought   | summer; a chunk with a farm             | that chunk's farms -20 %, to the season's end |

| Id        | First choice (free)    | Other choices                                                                  |
| --------- | ---------------------- | ------------------------------------------------------------------------------ |
| flood     | Leave it: repair later | Timber piles, 6 wood a piece: mended now, 50 % it floods again next spring     |
|           |                        | Stone bank, 14 stone and 2 iron a piece: mended now, this chunk floods no more |
| snowdrift | Wait it out            | Plough, 8 coal a piece: clear now                                              |
| landslide | Leave it: repair later | Project, 20 stone a piece, 3 days: mended, and 1 day's income                  |
| drought   | Wait it out            | Project, 100 water, 2 days: the effect ends, and +10 % to the season's end     |

Flood is the only chain: the timber choice can bring `flood` back to the same stretch the next
spring.

### Town life and good news

| Id       | When and where                      | First choice (free)                            | Other choices                                                      |
| -------- | ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| noise    | a town of 100+ with track beside it | Ignore it: growth -10 %, season                | Noise wall, 1 day's income: growth +10 %, season                   |
| fair     | a town of 100+, not winter          | Skip it                                        | Project, 60 food, 2 days: 1 day's income, passengers +50 %, 2 days |
| auction  | any time, income above the minimum  | Pass                                           | Buy the lot: 1 day's income of the scarcest good, at half price    |
| settlers | 2 or more towns                     | Town A: growth +30 %, season                   | Town B: the same                                                   |
| harvest  | autumn; at least one farm           | no choice: all farms +20 % to the season's end |

### Finds, when a chunk is bought

| Id       | Where                        | First choice (free)                             | Other choices                                                 |
| -------- | ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| trackbed | any chunk                    | no choice: iron and stone worth 1 day's income  |
| lode     | a chunk with rock or hills   | Keep it: its quarries and mines +15 %, for good | Sell the rights: 1 day's income                               |
| ruin     | a chunk with a town in reach | Leave it                                        | Dig, 1.5 days' income: that town's passengers +20 %, for good |

## 6. Notifications

Three rows join the Notifications screen, after `goal`:

| Row      | Name                  | Severity  | Starts on          | What it covers             |
| -------- | --------------------- | --------- | ------------------ | -------------------------- |
| evchoice | Events with a choice  | attention | popup, pause, icon | a decision waiting         |
| evtask   | Event tasks           | attention | icon, pin          | a repair or delivery to do |
| evnone   | Events with no choice | info      | toast              | news: harvest, trackbed    |

`evchoice` and `evnone` are the mock's. `evtask` is added so action items have their pins.

- On `evchoice`, Popup means the Event window. Each kind of event follows the row until the player
  picks a mode for it in the Event window; that pick is stored by event id, with the settings.
  Defaults on the Notifications screen clears the picks. With no pick the row gives the mode: popup
  and pause is Ask and pause, popup alone is Ask, keep running, no popup is Alert only.
- The switch **Skip events that need no choice: they go to the log** comes back, off by default.
  When on, `evnone` news reaches only the log.

## 7. Special projects

A project is a contract, so it needs no new delivery code, panel or train dispatch:

- `ContractBoard` gets a project contract: active at once, with a deadline, tied to its event. It
  takes the cargo, amount and destination from the event, and an origin from `pairs()`.
- It shows in the Contracts screen with a mark of its own, and does not count toward `activeFull`.
- A train is dispatched as for any contract. With no pair that can carry the cargo there, the choice
  is grey, with the reason.
- Done, it applies the event's reward. Late, nothing happens: no fine, no reward.

## 8. Track

All through #625, with two small additions to `TrackWear`:

- `hold(pieces)`: sets each piece's health just under the degraded line, and keeps it from wearing
  while held. Trains slow down on it as on any degraded piece, and it cannot fail.
- `release(pieces)`: ends the hold. At the end of its time a released piece is put back just over
  the degraded line, unless the player has already repaired it.

The repair is the normal Repair tool or a maintenance train. Once none of its pieces is degraded,
the action item closes. A piece taken up or replaced leaves the list.

The stone bank's "floods no more" is a chunk index in the events' memory; the flood's site finder
skips those chunks.

## 9. Structure

- `src/data/events.json`: one entry per event: id, trouble or not, seasons, weight, site kind,
  choices and their effects. Content is data, so the content editor can override it.
- `src/sim/events.ts`: the `EventDesk`. It keeps the next event's day, the open cases, the running
  effects, the chain follow-ups, the memory and the log; it picks events, applies choices and
  answers `productionMul`, `passengerMul` and `growthMul`.
- `src/sim/eventSites.ts`: the site finders (`river`, `hills`, `slope`, `farmChunk`, `town`, `towns`,
  `chunkRock`, `chunkTown`, `anywhere`). Pure functions of the world; a world with no such place
  gives null.
- `src/sim/step.ts`: at a new day, in play mode with `ctx.events`, one call to the desk. The
  multipliers go in where the famine multiplier and the catchment already are.
- `src/sim/notices.ts`: open cases become notices with a `target`, and `Game.focusNotice` does the
  rest.
- `src/ui/eventScreen.ts`, `src/ui/situationsScreen.ts`: on the kit and the modal frame. Event is
  frame M, Situations frame M.
- `Game.buyChunk`: one call for the discovery. Hub changes stay wiring.
- Text is `STR.events` in `src/strings.ts` and in `src/data/strings.hu.ts`. Town names are filled in
  at show time, so the save holds ids, not sentences.
- `payEvent` and `giveEvent` are the only two functions that move goods. Resource modes (#306)
  changes where goods live, and only these two follow it.

## 10. Determinism, saves and tests

**Determinism.** Each draw has a generator made from the map seed, a fixed salt and the day (a
discovery: the chunk index). There is no running stream, so no draw shifts a later one, a reload
cannot reroll, and game speed does not matter. The same seed and the same play give the same events.
Weather, contracts and walkers keep their own streams untouched.

**Soak goldens.** `StepContext` gets `events`; `trafficSoak.test.ts` leaves it off, and every
multiplier is exactly 1 with no effect running, so the digests do not move. If they do, that is a
bug in this work, not a number to update.

**Saves.** One new top-level key, `events`, in `KNOWN_SAVE_KEYS`, with the next free `SAVE_VERSION`
and a migration step that fills in the empty state. The log keeps the last 50 entries.

**Tests**, as invariants over the data, so a new event is covered by being added:

- every event's first choice is free, and every event has text in English and Hungarian;
- every bad effect is at most -20 % and at most one season, and only good effects last for good;
- every action item has a target, and closes when its place goes;
- a held piece cannot fail, and is healthy once its time is up;
- the same seed and the same world give the same events, at any game speed and across a save;
- no event takes money or goods without a choice;
- a choice that cannot be paid is refused and changes nothing;
- every site finder gives null on an empty world;
- the mode from the Notifications row and the stored pick.

## 11. Pictures

Twelve, one per event, painted by Codex: `specs/codex-events.txt` on the author's drive, into
`renders/event-art`. The window crops them to 2.4:1. They show no train, wire or age-bound thing,
since each event can come in any age. Until they arrive the window shows the mock's placeholder.
Icons are drawn in code, as the rest of the new UI.

## 12. Order

1. **Simulation:** the desk, data, sites, multipliers, projects, notices, saves and tests, with the
   nine events that need no track.
2. **UI:** the Event window, Situations, the three rows, the Skip switch, English and Hungarian. Shown
   in a review page from the running game before it is locked.
3. **Track events:** flood, snowdrift and landslide, once #625's hand repair is on develop.
4. **Pictures,** when Codex has painted them.

## 13. Choices Claude made, for the author to overrule

- Automation by event id rather than by category: twelve kinds need no categories.
- A third row, `evtask`, so repair and delivery items get a pin.
- Track an event hit mends by itself after its time, so ignoring it never closes a line.
- A late project costs nothing, only the reward is lost.
- Window names: "Situations" in English, "Helyzetek" in Hungarian.
