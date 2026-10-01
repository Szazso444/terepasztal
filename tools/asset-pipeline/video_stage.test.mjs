import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAWN_FACINGS, FACINGS } from '../../src/sim/body';

// The video route (video_stage.py) on a synthetic turntable video whose every frame's heading is known
// (video_fixture.py). It holds the stage to what the game needs of any vehicle's sprites, whatever the
// video: the drawn facings and only those, one canvas and one anchor for all of them, nothing cut off
// at the canvas edge, and each facing drawn from a frame that shows that heading.
const dir = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function hasDeps() {
  try {
    execFileSync(python, ['-c', 'import cv2, numpy, scipy, PIL'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const script = `
import json, sys, tomllib
from pathlib import Path
import numpy as np
from PIL import Image
import video_fixture, video_stage
out = Path(sys.argv[1])
cfg = tomllib.loads(Path("pipeline.toml").read_text(encoding="utf-8"))
results = {}
for turn in (-1, 1):
    sys.argv = ["video_fixture.py", str(out / f"fixture{turn}.avi"), "120", str(turn)]
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        video_fixture.main()
    fx = json.loads(buf.getvalue())
    dirs = {k: str(out / f"t{turn}" / k) for k in ("sprites", "atlas", "previews")}
    vcfg = {**cfg["classes"]["vehicle"], **cfg["video"]}
    info = video_stage.process_asset(fx["asset"], fx["video"], cfg["grid"], vcfg, dirs, log=lambda *a: None)
    frames = []
    for fr in info["frames"]:
        a = np.asarray(Image.open(fr["file"]).convert("RGBA"))[..., 3]
        edge = bool(a[0].any() or a[-1].any() or a[:, 0].any() or a[:, -1].any())
        shown = fx["facing_of_frame"][fr["video_frame"]]
        if fr["mirrored"]:
            shown = (12 - shown) % 48
        frames.append({"facing": fr["facing"], "anchor": fr["anchor_px"], "size": [fr["w"], fr["h"]],
                       "png": list(a.shape[::-1]), "edge": edge, "opaque": int((a > 0).sum()), "shown": shown})
    results[turn] = {"frames": frames, "warnings": info["warnings"]}
print(json.dumps(results))
`;

describe.skipIf(!hasDeps())('video_stage.py', () => {
  let out, runs;
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'video-stage-'));
    runs = JSON.parse(
      execFileSync(python, ['-c', script, out], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 24 }),
    );
  }, 300000);
  afterAll(() => out && rmSync(out, { recursive: true, force: true }));

  for (const turn of ['-1', '1']) {
    describe(`a turn of ${turn === '1' ? '+' : '-'}1`, () => {
      it('draws exactly the drawn facings', () => {
        const facings = runs[turn].frames.map((f) => f.facing).sort((a, b) => a - b);
        expect(facings).toEqual([...DRAWN_FACINGS].sort((a, b) => a - b));
      });

      it('puts every frame on one canvas with one anchor', () => {
        const [first] = runs[turn].frames;
        for (const f of runs[turn].frames) {
          expect(f.anchor).toEqual(first.anchor);
          expect(f.size).toEqual(first.size);
          expect(f.png).toEqual(f.size);
        }
      });

      it('leaves every frame clear of the canvas edge', () => {
        for (const f of runs[turn].frames) {
          expect(f.opaque, `facing ${f.facing} is empty`).toBeGreaterThan(0);
          expect(f.edge, `facing ${f.facing} touches the canvas edge`).toBe(false);
        }
      });

      it('draws each facing from a frame that shows its heading', () => {
        for (const f of runs[turn].frames) {
          const d = Math.abs(((f.shown - f.facing + FACINGS * 1.5) % FACINGS) - FACINGS / 2);
          expect(d, `facing ${f.facing} drawn from a frame at ${f.shown}`).toBeLessThanOrEqual(1);
        }
      });
    });
  }
});
