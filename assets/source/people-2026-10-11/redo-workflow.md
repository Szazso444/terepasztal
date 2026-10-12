## Current continuation — 2026-10-12

5/9 requested strips checked. See finish-report.json for accepted attempts and observations, redo-state.json for progress, and finish-brief-2026-10-12.txt for the current authority. Canonical strips use uniform area averaging and individual measured sole rows. Offline checks are under checks/: <strip>-9px-6x.png and <strip>-36px.png. Carry columns are at least256px; walks expand only when needed. Original inputs, guides, refs, review and game-scale exports are preserved. Historical notes below record earlier rejected attempts and superseded rules.

## Historical notes before Core acceptance

# Nine-strip repaint workflow · issue331

Image generation resumed on **2026-10-12** after the reported quota reset.
**11 new paintings are preserved;0of9production strips have been replaced.**
Pump-hand-back-walk f0 passed on attempt2. Its other three phases exhausted three
attempts each and failed the5% guide box test: selected widths differ by11.3%,15.1%
and13.0%. The selected contact/passing silhouettes are distinct. No fourth attempt
has been made. The author decision about keeping the best failed-box paintings is
pending; do not treat the diagnostic candidate as accepted.

The first-strip candidate and its native9px frames are under `checks/`, with all
measurements in `checks/pump-hand-back-walk-redo-report.json`. Browser automation
refused its local `file:` playback page under its URL security policy. Frame and
contact-overlay inspection is recorded; actual playback is **not verified**.
No workaround or paid API fallback has been used. All original28strips,
`review/`, `game-scale/` and `inputs/variations/` remain unchanged.

The full author brief is `redo-brief-2026-10-11.txt`. Its order, reference roles,
three-attempt limit and per-strip commit instructions are the authority.
Use built-in ImageGen **edits**, attaching the exact ordered references in the brief.
All exact edit prompts and ordered reference lists are under `calls/`. The first
quota rejection returned no painting; f0 attempt1 was later retried successfully
and its returned image was preserved. Do not repeat any painting attempt id that
already has a raw file.

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
