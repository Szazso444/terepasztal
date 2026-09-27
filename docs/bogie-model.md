# Bogies and bodies on curves: the target model

The player's follow-up explicitly selects **the rigid body shown in the reference diagrams**.
This supersedes the sliced-body proposal previously recorded here. The earlier
[three-step illustration](img/bogie-model.png) remains as historical reference, not a requirement
to slice or bend a rigid casing.

## Rules

1. Bogies remain on their exact rail arc positions and use their individual track tangents.
   They slide relative to the body's sockets and swivel independently of its facing. There is
   no drawing-only lateral clamp and no body-alpha mask hiding their movement.
2. Each rigid segment is drawn as one fixed-length sprite, using `poseSegment`'s position and
   angle, including its track-centred sideways shift. Large rigid locomotives keep one full
   three-tile body. Garratt engines retain their three articulated segments; the Meyer frame
   remains rigid above its two pivoting engine units. No artificial middle hinge or slices.
3. Geometry and compatibility remain separate from cosmetic wheel count. Existing pivot
   spacing, body lengths, bogie counts and tolerance limits are retained. Changing two axles
   to three changes the shared bogie sprite, not its rail position or the turn verdict.
4. Four wheels means two axles, with two wheels on each axle; six wheels means three axles.
   F7, Taurus and Re460 use pairs of four-wheel bogies. M62, SD40, Deltic and V63 use pairs of
   six-wheel bogies. DDA40X and GG1 keep three six-wheel bogies. Small steam stock retains its
   baked driving wheels. Both sides of a shared bogie are drawn and depth-occluded naturally.
5. Raised sills leave space below the body to see the moving wheel groups. All bogies sort
   beneath their vehicle's body parts, so they cannot paint over opaque body pixels. Visible
   wheels below the sill or beside a rigid chord on a tight curve are intentional. The old
   requirement that every bogie pixel be contained in the body alpha is withdrawn.
6. Existing reversal preserves the physical trail, reverses its point order and reindexes arc
   distance. The renderer's facing correction preserves the vehicle's orientation. Retreats
   preview their reversed trail and reserve a complete route before committing that reversal.

## Rendered stock (train models pilot 2, pending approval)

7. Coupled driving wheels are rigid in a real locomotive frame, so rendered rigid-frame steam engines
   draw them, with their rods, splashers and frames, as part of the body sprite. The body's centring
   on the track keeps them on the rails near the middle of the body. Only what swivels on the
   prototype is a bogie sprite: the leading bogie, the trailing axle, a tender's trucks. A rigid tender
   draws its axles with its body (`bogieStyle` `"none"` there). Articulated engine units (Big Boy,
   Garratt) keep swivelling.
8. Bogie sprites are per train (`rolling/bogie_<id>_<position>_f<n>`), rendered in the same run as the
   body; the shared family styles remain for stock not yet rendered. Parts a prototype hangs on its
   bogie go on that sprite; pilots and snowplows fixed to the body frame stay on the body.
9. `bogieDraw` (per vehicle, tiles along the track from each pivot, + towards the vehicle's front)
   draws a bogie sprite where the prototype has its truck. The sprite sits on the rail at that point
   with the rail's own tangent there (`BogiePose.drawX/drawY/drawAngle`); the pivot, the body pose
   and every curve verdict are unchanged.

## Verification

- `scratchpad/verify-bogies.mjs` sweeps all medium and large models over every permitted class,
  with four orientations, both turn hands and both travel orientations. It checks rigid part
  count, rail positions, per-bogie facing and rotation, axle-group textures, and visible wheel
  pixels using separate body and bogie alpha passes. It deliberately rejects masking the wheels.
- `scratchpad/verify-curves.mjs rigid-after` checks the five large models and a medium locomotive.
  DDA40X and GG1 still pass high-speed geometry and fail regular geometry; all large models
  remain barred from regular track. Articulated geometry passes do not override that size rule.
- `scratchpad/verify-bogie-sequence.mjs` shows straight, entering, middle and leaving poses.
  `scratchpad/rollout.mjs rigid-after` captures an actual depot rollout paused on the 2x2 curve.
- `scratchpad/verify-assets.mjs rigid-after` records atlas bounds and generation time. All art
  remains procedural, with the refreshed palette and materials retained.
