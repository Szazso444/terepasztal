# Track toolbar: types with hotkeys, wide track, upgrade and downgrade tools

Status: asked for in conversation 2026-10-02 (sub-project 2 of the building work; independent of
the art). Branch: `ui/track-toolbar` from `origin/main`.

## Goal

Laying track by keyboard: the track pieces are grouped by type, every piece of a type has a
number key and one key steps between types. Regular track is called wide track. Two new tools
turn wide track into high-speed track and back by dragging along it.

## 1. Names

The track class shown as "Regular" is shown as "Wide" everywhere a player reads it (toolbar,
tooltips, messages, tuning labels). The id `regular` in code, data and saves does not change.

## 2. Types and hotkeys

The Track category shows a row of types, in this order: **Narrow, Wide, High-speed, Bridges**.
One type is open at a time; its pieces are listed under it with short names.

| Key | Narrow          | Wide       | High-speed      | Bridges |
| --- | --------------- | ---------- | --------------- | ------- |
| 1   | Straight        | Straight   | Straight        | Wooden  |
| 2   | Curve           | Curve      | Curve           | Stone   |
| 3   | Switch          | Switch     | Switch          |         |
| 4   | Crossing        | Crossing   | Crossing        |         |
| 5   | Crossing × Wide | Transition | Crossing × Wide |         |

- **1 to 5** pick a piece of the open type.
- **Q** and **E** step to the previous and the next type and keep the piece's slot and its turn:
  holding a curve, E gives the next type's curve. A type with nothing to offer is skipped.
- **Tab** and **Shift+Tab** step through every piece of the category as before; **R** turns.
- Opening the category returns to the type used last (the first time: Narrow).
- The info panel keeps the full names ("Curve (High-speed)").

Other categories are unchanged.

## 3. Upgrade and Downgrade tools

Two buttons beside Remove: **Upgrade** (key U) and **Downgrade** (Shift+U). With a tool chosen,
every piece the cursor passes while the left button is held is converted: Upgrade turns wide
track into high-speed track, Downgrade turns high-speed track into wide track. A click converts
the piece under the cursor.

- The piece keeps its shape, its turn, a switch its form, and everything standing on it (signals,
  wires, trains).
- **Trains.** High-speed track takes only trains with in-cab signalling (the game's rule for
  high-speed track however it is laid). The Upgrade tool's hint says so, and its status line says
  how many of the player's trains have none.
- **Joints.** Wide and high-speed track join only through a transition piece, so the tools keep
  the line connected by themselves:
  - a converted straight that still meets track of the other type becomes a transition; when the
    track beside it is converted too, it becomes plain track of the new type;
  - a converted curve, switch or crossing turns the straight beside it into the transition;
  - where a curve, switch or crossing meets another one with no straight between, the conversion
    carries on through it to the next straight.
- **Crossings.** Only the line being converted changes: a wide × wide crossing with one line
  upgraded becomes wide × high-speed. A crossing with a narrow line keeps its wide line (there is
  no narrow × high-speed crossing); the track beside it ends in a transition.
- **The stroke.** A fast cursor skips tiles between frames, so every tile on the way is converted.
  A crossing is taken by the direction the stroke runs in, read over its last few tiles: a hand
  that wobbles a tile to the side still converts the line it runs along. A stroke that starts on
  a crossing waits for its first move; a click on a crossing converts the line that track of the
  new type already runs up to, else both. A cursor that leaves the field starts a new stroke where
  it comes back.
- **Narrow track** is not converted (its curves are a different size); the status line says so.
- **Cost.** Upgrade charges, per piece, the difference between the new piece's price and the old
  one's, each as it would be charged on that ground.
  When the next piece cannot be paid for, nothing changes and the status line says so. Downgrade
  costs nothing and returns nothing.
- A transition piece gets four turns instead of two, so its high-speed half can face either way;
  the tools turn it the right way round.

## 4. Proof

- Unit tests: types and slots; stepping between types; the conversion plan (straight runs,
  frontier transitions, curves and switches, crossings by line, narrow crossings, extension
  through joined curves, transitions merging away, downgrade); cost; the builder applying a plan.
- Game renders on the review page: the toolbar with each type open, and a line being upgraded and
  downgraded by dragging.
- Typecheck, lint, tests, build and formatting pass before every push.
