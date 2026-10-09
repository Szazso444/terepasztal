# Verification

Mathematical and logical claims about the game are checked by tests that give the same answer on
every run, never by an agent's reading of the code. This file is the standard those tests meet and
the map of what they cover.

## Standards

- **Deterministic.** No `Math.random`, no wall clock, no timers, no network. Random cases come from
  `Rng` (`src/engine/rng.ts`) with a fixed seed list; a test that explores seeds prints the seed of
  any failure in its message so the case can be replayed alone.
- **Node only.** Tests run under vitest with no DOM and no Pixi. A module that imports Pixi is
  tested through the pure functions it is built on; if there are none, the finding is that the
  logic should be pulled out, which is a task for the owning role.
- **Invariants, not snapshots.** A test states a property that must hold for every input of a
  class (a path never reverses mid-tile; a migration chain reaches the current version from every
  older one). Golden values are for outputs whose exact bits are the contract, such as map
  generation hashes, and a golden failure is a question for the author, not a number to update.
- **An oracle where there is one.** A fast algorithm is checked against a slow obvious one on
  small inputs: Dijkstra against exhaustive search on a few tiles, a closed-form length against a
  sampled one.
- **Smallest failing case.** A property test that fails reports the smallest input it found, by
  trying smaller inputs from the failing one before it gives up.
- **One file per module.** Properties for `src/world/pathfinding.ts` live in
  `src/world/pathfinding.test.ts`. Shared generators and helpers live in `src/testing/`.
- **One runner.** Property tests use `forAll` from `src/testing/property.ts`, not their own loop.

## Properties

The areas below have a property that must hold. Each row names the test that pins it, or `—`
where the test is still to be written. Verification keeps this table current.

| Area | Property | Test |
| --- | --- | --- |
| Save format | every older version migrates to `SAVE_VERSION`; each step only fills defaults; unknown keys survive | `src/sim/save.test.ts` |
| Map generation | terrain, biome and variant planes are bit-identical for a seed | `src/world/mapgen.test.ts` |
| RNG | the same seed gives the same stream; `state` resumes it | `src/engine/rng.test.ts` |
| Pathfinding | a returned path is legal at every step (entry edge to exit edge through the piece), never reverses mid-tile, and is no longer than any other legal path | — |
| Track geometry | curve radius `n - 0.5`, footprint `n x n`, cost `n x 1.5` above regular, for every class `n` | — |
| Rigid bodies | car length is constant along any path, curves included | `src/sim/body.test.ts` |
| Traffic sections | two trains never hold the same section | `src/sim/traffic.test.ts` |
| Separation and deadlock | trains never overlap; a stuck pair resolves in bounded ticks | — |
| Economy | money and cargo change only through a recorded transaction | — |
| Facings | mirroring a drawn facing and its residual rotation reproduce the true heading | — |
