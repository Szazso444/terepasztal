# Depot gate review

All 24 pictures are recorded as generated. The family check reports 24 checked,
0 failed. The depot gate remains closed; no station work was started.

Review `depot.png` for appearance and `depot-angles.png` for footprint alignment.

## Camera exceptions

| Picture | Kept camera error |
| --- | --- |
| depot-a0-r2 | 3.0 degrees |
| depot-a0-r3 | 5.0 degrees (inherited) |
| depot-a2-r2 | 2.5 degrees (correct second attempt recovered as requested) |
| depot-a4-r2 | 4.4 degrees (correct second attempt recovered) |
| depot-a4-r3 | 2.2 degrees (closest second attempt retained by tool) |

No depot pictures remain rejected. Earlier attempts and the superseded rejected
electric picture remain in the tool-managed, ignored files.

## Visual findings for the user's decision

- Earlier recorded pictures `depot-a0-r1`, `depot-a1-r2`, and `depot-a2-r1`
  show crew doors on rear walls. The steam and electric rear quarter-turns also
  carry the front's tall windows. These were discovered on the finished family
  sheet; they were not put back or repainted at the gate.
- Magnetic `r2` and `r3` earlier-self references had roof directions inconsistent
  with the portal end walls; the `r2` reference also omitted portals. These
  repaints restore the portal wall and roof direction, but roof glazing, window
  counts, and portal trim still differ between views. In particular, magnetic
  `r2` lacks the fanlights and coil treatment visible in `r0`/`r1`.
- Hyper `r2` earlier-self reference omitted portals. Its repaint restores them,
  but their plain copper arches differ from the fanlights in the other views.

The repeated generation faults were front doors/windows added to rear views,
copying a reference's orientation instead of the guide, rails inside portals,
and camera drift. After the prompt update, both hyper rear views kept their rear
walls plain. Correct attempts refused only for camera were preserved according
to the user's recovery instruction.

Pictures were made with the built-in image generation tool as guide-image edits,
using the queue's prompts and ordered references. Targeted correction paragraphs
were added for failed attempts. The queue remains the progress record.
