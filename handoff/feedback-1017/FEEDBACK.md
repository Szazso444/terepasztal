# The author on demo v9 (chat, 2026-10-17, verbatim)

"Wind and waves on the still water is a little too aggressive, can it be slighter and smaller? The waves on shores are better The rest is good!

The walking animation is a little wonky when going to the észak nyugat és észak keleti irányba."

(észak nyugat = north-west, észak keleti = north-east. In the demo north is the top of the screen, so these are walkers
heading up-left and up-right on screen: walking away from the camera, the back views, the up-left ones mirrored.)

## Core's reading
1. Open-water waves (the Waves treatments on the sea and the lakes: crests, gust tint and sheen, swell bands, chop
   and its white caps) are too strong and too big at the default (Breeze, Swell). Make them slighter (less contrast,
   lower alpha) and smaller (shorter wavelength / smaller crests), at every weather level, keeping the same ideas
   and the wind direction. Keep the ordering Breeze < Windy < Storm. The shore swash (drawShore: foam run-up,
   backwash, wet sand, film) is good: do not change it, beyond what the open water's new scale strictly needs for
   the two to meet (the swash's own rhythm may keep its lam and T).
2. People walking up-left and up-right (back views, Fixed walk) look wonky. Everything else in v9 is approved.

# The author, second message (chat, 2026-10-17, Hungarian, translated by Core)

"Actually the wind is fine. Keep it as it is in the demo. It will be good. Can you also set the windmill's speed
relative to the wind? A little fewer dead bushes in the desert: reduce the rate to 20% of the current one. In the
walking, the problem is probably that in the pictures the legs' positions are not right, the ones moving north
(northward). Maybe these should be fixed with Codex. The windmill is rendered at a slightly wrong angle, could you
set it? The buildings' sizes have not been set yet. I feel the people and the roads should have bridges too; how
could we solve that?"

## Core's reading (supersedes the first reading where they differ)
1. Wind: stays exactly as in v9 (trees, desert, smoke, gusts). The open-water waves: the author first asked for them
   slighter and smaller, then said the wind is fine. Core keeps both: a new "Wave strength" switch, Gentle (the
   new default, slighter and smaller) and v9 (as published). The shore swash is unchanged in both.
2. Windmill speed follows the wind continuously: its strength and the gust at the hub, so a gust visibly speeds the
   sails up and a lull slows them; calm stops them. A level change eases over a few seconds as now.
3. Desert dead trees (the demo's props/deadtree_* among the cacti on desert sand): 20% of the current rate. Cacti
   unchanged. (The game itself places no dead trees on desert sand; this is the demo's.)
4. Walking north (up the screen, the back views): the author thinks the painted leg positions are wrong. No demo
   walk changes. Instead a precise, frame-by-frame defect list per back strip, for a Codex repaint prompt.
5. Windmill angle: find what is off against the game's 2:1 camera (the body's axes, the cap, the sails' plane) and
   fix what the demo can; say what only a repaint can fix. Compare with Codex's delivered windmill (#461).
6. Building scale "not set yet": unclear. Check that the Building scale switch really changes the published page
   (True to people against As before), and report what it changes; Core asks the author what they meant.
7. Bridges for people and roads: a design question, handled outside the demo.

# The author, third message (chat, 2026-10-17, Hungarian, translated by Core)

"In Building life the chimney smoke's animation is a little wrong. It does not rise high enough, and it could be
sparser. And by the size I mean that True to people is still not right in the demo."

## Core's reading (for the round after v9.1)
8. Chimney smoke: rises clearly higher (a plume of several storeys above the roof before it fades, bending
   downwind with height), and sparser: fewer, more widely spaced puffs, fewer chimneys lit, a thinner plume.
9. Building scale: True to people still looks wrong to the author. The original complaint (16 October) was that
   some buildings look bigger than they should beside the people. v9's measurement concluded that most pictures
   were already true. Re-measure from scratch, and offer the author settings to compare, so the author can pick:
   - As before (v8);
   - True v9 (as now);
   - Smaller: every building, houses, town hall and station included, at the size a 1.75 m person asks, read
     strictly (a door 2.0 to 2.2 m, a storey about 3 m), not limited to its tile;
   - People larger: v8 buildings, the people drawn about 1.25 times larger (in case the people are what is off).
   Show me 'Building scale' with a standing figure at each door.

# The author, fourth message (chat, 2026-10-17, Hungarian, translated by Core)

"The road bridge sounds good. Could you make it so that if it is next to a plain bridge, it widens and they become
one? In Storm there could be more weather effects too, for example lightning, rain, fog and so on."

## Core's reading (for the round after v9.1)
10. Road bridges (option A of bridges-plan/PLAN.md, chosen): a road may go onto a bridge platform without rail;
    walkers cross on it. Show them in the demo: a road bridge over the river on its own (wood and stone, as the
    Bridge deck switch picks), and one built right beside the demo's rail bridge, where the two become one wider
    bridge: one deck across both tiles, piers and parapets shared, parapets only on the outer edges, the rail on
    one half and the road on the other, the road's gravel or setts meeting the deck's planks or stones. Walkers
    cross both. Defaults Core assumes until the author says otherwise: wood and stone as for rail, the same span
    rules as rail bridges, no footbridges away from roads, one tile holds rail or road (side by side they merge).
11. Storm weather: with Weather Storm, rain (slanted by the wind, light streaks, a wet darker ground and ripples on
    the water), an overcast darker light, and lightning now and then (a bolt far off and a short, gentle brightening,
    never a strobe: at most one flash every several seconds, and none with prefers-reduced-motion). Fog as its own
    setting to compare (Fog: Off, Valley mist low in the valleys and over the water, Thick), drifting slowly with
    the wind. Calm, Breeze and Windy stay as now unless the author asks.
