# Verification

Mathematical and logical claims about the game are checked by tests that give the same answer on
every run, never by an agent's reading of the code. This file is the standard those tests meet and
the map of what they cover.

## Standards

- **Deterministic.** No `Math.random`, no wall clock, no timers, no network. Random cases come from
  `Rng` (`src/engine/rng.ts`) with a fixed seed list; a test that explores seeds prints the seed of
  any failure in its message so the case can be replayed alone.
- **Time limits.** vitest gives a test 5 s unless it says otherwise, and a loaded machine (other
  test runs, agents, a busy CI runner) stretches a test several times over: tests ran up to seven
  times slower at a load average of 27 on four cores. A test that takes a third of a second or more
  alone carries a limit of its own (the options or third argument of `it`), at least four times
  what it takes alone and in practice twenty, with a comment above it on why it is slow, how long
  it takes alone and the limit; the repository default is not raised to cover it. (A third of a
  second is the shortest of the tests that timed out in the gate runs of #458.) A `beforeAll` or
  `afterAll` has a default of its own, 10 s, and the same rule at the same size. To find a test or
  hook that lacks its limit, run `npx vitest run --maxWorkers=1 --testTimeout=300 --hookTimeout=300`
  on a quiet machine (all of it takes as long as a quiet full run): each failure that reads "timed
  out" has no limit of its own. Run it alone again before adding one, since a busy machine pushes a
  test of 0.25 s past 300 ms. Cutting seeds or cases to be faster is allowed only where the
  property is still covered.
- **Node only.** Tests run under vitest with no DOM, canvas or renderer. `pixi.js` imports under
  Node and its scene-graph classes construct, but logic is best tested through the pure functions
  it is built on; if there are none, the finding is that the logic should be pulled out, which is
  a task for the owning role.
- **Invariants, not snapshots.** A test states a property that must hold for every input of a
  class (a path never reverses mid-tile; a migration chain reaches the current version from every
  older one). Golden values are for outputs whose exact bits are the contract, such as map
  generation hashes, and a golden failure is a question for the author, not a number to update.
  The sprite frame table (`src/art/atlasFrames.golden.json`) is the exception: Art re-records it
  in the pull request that changes a generator on purpose, with
  `UPDATE_ATLAS_FRAMES=1 npx vitest run src/art/atlasFrames.test.ts`, and QA reviews the table
  diff. It is not a gate file and not a question for the author.
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

| Area                    | Property                                                                                                                                                                                                                                                                                                                                                                                                             | Test                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Save format             | every older version migrates to `SAVE_VERSION`; each step only fills defaults; unknown keys survive                                                                                                                                                                                                                                                                                                                  | `src/sim/save.test.ts`                                   |
| Map generation          | terrain, biome and variant planes are bit-identical for a seed                                                                                                                                                                                                                                                                                                                                                       | `src/world/mapgen.test.ts`                               |
| RNG                     | the same seed gives the same stream; `state` resumes it                                                                                                                                                                                                                                                                                                                                                              | `src/engine/rng.test.ts`                                 |
| Pathfinding             | on single-class narrow and regular layouts, a returned path is legal at every step (from the start state, entry edge to exit edge through each piece, to a target), never reverses mid-tile, costs exactly an exhaustive search's minimum, is null exactly when no path exists, and honours avoid and access                                                                                                         | `src/world/pathfinding.test.ts`                          |
| Track geometry          | one-tile links run from edge midpoint to edge midpoint and reverse exactly, and the closed-form length is the limit of the sampled one; every multi-tile unit's member links join end to start across tile borders, and each route enters and leaves by the edge midpoints the one-tile piece of its rotation uses, at its closed-form length; radius is `n - 0.5` and the footprint is `n x n`, for every class `n` | `src/world/trackGeom.test.ts`, `src/world/track.test.ts` |
| Rigid bodies            | car length is constant along any path, curves included                                                                                                                                                                                                                                                                                                                                                               | `src/sim/body.test.ts`                                   |
| Traffic sections        | two trains never hold the same section                                                                                                                                                                                                                                                                                                                                                                               | `src/sim/traffic.test.ts`                                |
| Separation and deadlock | trains never overlap; a stuck pair resolves in bounded ticks                                                                                                                                                                                                                                                                                                                                                         | —                                                        |
| Economy                 | money and cargo change only through a recorded transaction                                                                                                                                                                                                                                                                                                                                                           | —                                                        |
| Facings                 | mirroring a drawn facing and its residual rotation reproduce the true heading                                                                                                                                                                                                                                                                                                                                        | —                                                        |
| Sprite frames           | every generated frame keeps its key, size and anchor (`track` by key only: a stub canvas has no ink); no key in two groups; rolling and wagon families carry exactly the drawn facings; generation never calls `Math.random`                                                                                                                                                                                         | `src/art/atlasFrames.test.ts`                            |
