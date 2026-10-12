# Nine-strip repaint workflow · issue331

Preparation is committed here; **no new painting has been returned yet**.
The built-in ImageGen call for pump-hand-back-walk f0 was rejected with
`429 usage_limit_reached`. The tool reported reset at **2026-10-12 14:59:18
America/Toronto**. See `redo-state.json` and `prompts.json["redo-2026-10-11"]`.
No call to a paid API fallback has been made.

The full author brief is `redo-brief-2026-10-11.txt`. Its order, reference roles,
three-attempt limit and per-strip commit instructions are the authority.
Use built-in ImageGen **edits**, attaching the exact ordered references in the brief.
The first edit prompt and reference list are in
`calls/pump-hand-back-walk-f0-attempt-1.json`; a usage-limit rejection returns no
painting, so attempt1 remains available for the first actual image.

## What is ready

- `make-pose-guides.mjs`: Node/pngjs only.36 grey guides, hand-traced joints,
  body anchors, load blocks and reference crops. Geometry is in `pose-geometry.json`.
- `pose-png.mjs`: shared PNG reads/writes, bounds and uniform area averaging in
  premultiplied alpha. Transparent stored colour cannot tint an edge.
- `check-poses.mjs`: records every returned painting byte for byte; measures its
  aspect ratio, box and centre against the scaled guide; selects accepted poses;
  makes the contact overlay and records visual cycle findings.
- `assemble-strips.mjs`: uses the guide point to anchor the body; one uniform
  scale in both axes;192/256/320px columns according to reach. It makes9px
  playback artifacts in **checks/**, never in **review/**.
- `redo-protection.mjs`: original-strip backups and hashes of249 protected
  files. All original nine strips are backed up byte for byte in `raw/`.
- `pose-tools.test.mjs`: tests alpha integration, anchor placement and all36
  guide canvases/boxes.

`inputs/variations/`, `review/`, `game-scale/` and the nineteen unlisted strips
stay unchanged. The existing export/review scripts must not be run during this redo.
The old review and game-scale files intentionally remain snapshots of the earlier
draft; they will not preview repainted source strips.

## Resume commands

Run from the repository root with its existing devDependencies installed:

```text
node assets/source/people-2026-10-11/check-poses.mjs status
node assets/source/people-2026-10-11/redo-protection.mjs check
node --test assets/source/people-2026-10-11/pose-tools.test.mjs
```

Before each strip, back up its current picture (the command preserves the earlier
backup). For each image-tool call, write `calls/<id>.json` with the exact prompt,
strip, frame, ordered relative references and id from the author brief.
Use at most three returned paintings per pose. Record a failed tool call with
`error`; it is not a returned painting and does not consume a painting attempt.

```text
node assets/source/people-2026-10-11/check-poses.mjs backup <strip>
node assets/source/people-2026-10-11/check-poses.mjs record <strip>-f<k>-attempt-<a> --from <image-tool-returned-path>
node assets/source/people-2026-10-11/check-poses.mjs accept <id> --note "<observed identity, style and pose checks>"
```

Inspect each returned picture. Retry a failed box or repeated pose within the
three-painting limit. The tools preserve every raw returned file unchanged.
Accepted files in `poses/` are direct copies; replacing an accepted pose is
allowed only if its earlier bytes still match its recorded raw painting.

Once all four poses pass the box check and visual inspection:

```text
node assets/source/people-2026-10-11/assemble-strips.mjs <strip>
node assets/source/people-2026-10-11/check-poses.mjs compare <strip>
```

Look at `checks/<strip>-contact-overlay.png`: f0 over f2 at50%opacity.
Check the reversed thigh overlap and the opposite lifted feet. **Play**
`checks/<strip>-playback.html` at9px before committing. Record those visual
findings explicitly; no tool result alone certifies a walk cycle:

```text
node assets/source/people-2026-10-11/check-poses.mjs cycle <strip> --contact-x yes --passing-alternates yes --played yes --note "<findings>"
node assets/source/people-2026-10-11/redo-protection.mjs check
```

If a pose still repeats after three returned paintings, keep the best, record
`no` for the failed cycle check, state the affected frames in the report and
notify Core that0,1,0,1is available as fallback. Do not claim a four-pose cycle
passed. A failed box after all attempts has no automatic acceptance exception.

Fully check and commit **pump-hand-back-walk** before painting strip2.
Commit each completed strip with
`Art: <strip> repainted as a four-pose cycle`, then push only
`HEAD:refs/heads/art/331-people`. Update progress in `redo-state.json`.
