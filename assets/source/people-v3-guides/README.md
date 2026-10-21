# People pose guides (issue #489, for the people repaint R7c)

Grey mannequins in the walk cycle, drawn by `tools/people-guides.mjs` in the game's own projection
(`project()` of `tools/building-kit.mjs`: 30 degrees down, a 2:1 ground), so a painting made over them
has the camera, the size and the gait of the game. The earlier repaints failed because Codex copies
the legs of any painting attached to it; these guides have the right legs, and the identity crops
below have none.

## What is here

- `<view>-<arm>-p<pose>.png`: 32 guides, 1024 x 1536, transparent. `view` is `back` or `front`,
  `arm` is `swing`, `shoulder`, `block` or `yoke`, `pose` is 1 to 4.
- `manifest.json`: for every guide the joints in body units and in canvas px, the ground point, the
  top of the head and the first and last drawn rows.
- `identity/<strip>-upper.png`: 28 crops, 512 x 768 (the guide layout at half size), and
  `identity/identity.json`.

## The poses

Time order; repainted frame k (0 to 3) is pose k + 1, and the demo plays 0, 1, 2, 3.

| Pose | Step    | Right leg                      | Left leg                       | Arms                               |
| ---- | ------- | ------------------------------ | ------------------------------ | ---------------------------------- |
| 1    | contact | leads: heel down, toe up       | trails: toe down, heel lifted  | left forward, right back           |
| 2    | passing | planted, flat, standing        | swings: thigh forward, knee 55 | both near the body                 |
| 3    | contact | trails: toe down, heel lifted  | leads: heel down, toe up       | right forward, left back           |
| 4    | passing | swings: thigh forward, knee 55 | planted, flat, standing        | both near the body                 |

At contact the pelvis is 1% of the height lower than at passing (the head stays where it is). At
passing the swing foot clears the ground by about 5% of the height.

Arm variants (the same legs in all four):

- `swing`: both arms swing against the legs (walks).
- `shoulder`: the right hand holds a log or sheaf on the right shoulder (the grey bar is only the
  space it takes), the left arm swings.
- `block`: both forearms forward and up, hands at the sides of a carried stone (the grey box).
- `yoke`: both hands on a yoke across the shoulders (the grey bar; the buckets hang below it).

## The direction

- `back`: the person walks along tile -y, **up and to the right** on the screen. The camera sees the
  back and the right side in three quarters. The up-left walk is this picture mirrored (the game does
  that; there is no guide for it).
- `front`: the person walks along tile +x, **down and to the right**. The camera sees the face and
  the front-right side. The down-left walk is this mirrored.

These are not straight-away views: the body is turned 45 degrees to the camera, so the shoulders are
not level on the page and the leading foot is higher (back) or lower (front) in the picture than
the trailing one.

## Size, rows and anchors

- The figure is 960 px from the top of the head to the **ground point** (the point on the ground
  under the pelvis), the same in every pose and view. 9 px in the game, so 1 game px is 106.7
  canvas px. The ground point is on column 512 (and `groundPoint` in the manifest gives its row).
- The **sole row** is row 1440 in every guide: the lowest row at least 36 px wide (`soleRow` in the
  manifest), the sole proper that a painted boot also has. The foot box of the mannequin ends below it in
  a sharp corner a few px wide (up to 16 px lower, `bottom` in the manifest); no painted boot has that
  corner, so a painting's lowest opaque row falls on the sole row, not on the corner. (Before 21 October
  2026 the corner was put on row 1440 and the paintings of R7c-1 stopped 9 and 17 px short of it.)
  Because the body is turned, the ground point is not on that row: the foot toward the camera stands
  lower on the page than the ground point, by up to about 100 px (front views), so rows 1440 and
  `groundPoint` differ per guide, and the figure's top-to-sole height is 960 to about 1060 px. Do not
  "correct" this by putting both soles on one row or by shrinking the figure.
- **The planted foot slides back 0.123 of the height per pose** against the body (the walker
  advances 0.031 tile = 1.11 world px of a 9 px figure per pose), so the feet do not skate on the
  ground. The guides already have it: heel at pose 1, flat at pose 2, toe at pose 3 of one foot are
  the same spot of ground.
- A packer who wants the exact anchor takes it from `groundPoint` (the walker's tile position is the
  ground point); one who anchors at the sole row takes row 1440 and is off the exact
  anchor by the depth stagger (under 1 game px, up to 95 canvas px) of the slide.

## What to attach to a painting call, and what never

Attach: the guide of the pose, and the identity crop of the same person (front strips' crops serve
for the back repaints of the same person's face and clothes), nothing else.

The identity crops are the strip's own most typical frame (the one whose upper body overlaps the
other three best), cut at the hip line (0.52 of the height) and faded to nothing over 0.06 below
it. They carry the face, hair, clothes and the load; they carry no legs, so the pose cannot be
copied from them. They are at half the guides' scale and layout (baseline row 720, centre column
256): paint at the guides' size.

**Never attach** a painted strip or frame with legs (any of the old `people-2026-10-11` strips and
their frames, an earlier repaint attempt): Codex copies their legs.

## Making them again

```text
node tools/people-guides.mjs                       # the 32 guides and manifest.json, here
node tools/people-guides.mjs identity <strips>     # identity crops from a folder of the 28 strips
node tools/people-guides.mjs sheet <dir> <png> [shrink]   # a small contact sheet of a folder
```

The strips are `<person>-<front|back>-<walk|carry>.png` (768 x 512 and wider, four columns) from
`assets/source/people-2026-10-11/` of the art/331-people branch, not on `develop`; the crops here
were made from them as they stood on 2026-10-17. `tools/people-guides.test.mjs` regenerates the
guides and checks them against these files.
