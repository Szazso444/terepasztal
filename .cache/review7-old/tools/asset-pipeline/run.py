#!/usr/bin/env python3
"""Batch pipeline: image -> ComfyUI (3D) -> Blender (align/scale/render) -> post (sprites/atlas) -> game.

Stops at the first error with a non-zero exit code. Finished stages are skipped on rerun unless --force.
Usage: python run.py [--only id1,id2] [--stages comfy,blender,post,game] [--force] [--config pipeline.toml]
"""
import argparse
import csv
import json
import logging
import re
import subprocess
import sys
import time
import tomllib
from datetime import datetime
from pathlib import Path

import comfy_client
import export_game
import game_rules
import postprocess

HERE = Path(__file__).resolve().parent
STAGES = ("comfy", "blender", "post", "game")
log = logging.getLogger("pipeline")


class PipelineError(RuntimeError):
    pass


def num(v):
    v = (v or "").strip()
    return float(v) if v else None


def load_assets(csv_path: Path, only):
    rows, errors, seen = [], [], set()
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        for ln, row in enumerate(csv.DictReader(fh), start=2):
            aid = (row.get("id") or "").strip()
            if not aid or aid.startswith("#"):
                continue
            err = []
            if not re.fullmatch(r"[a-z0-9_\-]+", aid):
                err.append("id must be [a-z0-9_-]")
            if aid in seen:
                err.append("duplicate id")
            seen.add(aid)
            cat = (row.get("category") or "").strip()
            try:
                a = {"id": aid, "category": cat, "image": (row.get("image") or "").strip(),
                     "size_tiles": int(num(row.get("size_tiles"))) if num(row.get("size_tiles")) else None,
                     "length_m": num(row.get("length_m")), "width_m": num(row.get("width_m")),
                     "height_m": num(row.get("height_m")),
                     "align": (row.get("align") or "auto").strip() or "auto",
                     "game_frame": (row.get("game_frame") or "").strip(),
                     # blank = let a cut vehicle pick its nose end; any number is kept as given
                     "yaw_offset_deg": num(row.get("yaw_offset_deg")),
                     "plan": (row.get("plan") or "").strip() or None,
                     # cut positions in metres from the nose, ';' between them (',' is the CSV's)
                     "split_m": [float(v) for v in (row.get("split_m") or "").split(";") if v.strip()],
                     # one height, or one per rendered part front to back, ';' between them
                     "clip_below_m": [float(v) for v in (row.get("clip_below_m") or "").split(";") if v.strip()],
                     # bogies: drawn this far ahead of the pivot the game hangs them at
                     "anchor_offset_m": num(row.get("anchor_offset_m")) or 0.0,
                     # bogies: compression along the track, that of the vehicles they ride under
                     "length_factor": num(row.get("length_factor"))}
            except ValueError as e:
                errors.append(f"line {ln} ({aid}): {e}")
                continue
            if cat not in ("vehicle", "building", "bogie"):
                err.append("category must be vehicle|building|bogie")
            if cat in ("vehicle", "bogie") and not a["length_m"]:
                err.append(f"{cat} needs length_m")
            if cat != "vehicle" and (a["plan"] or a["split_m"]):
                err.append("plan and split_m are for vehicles")
            if cat != "bogie" and (a["anchor_offset_m"] or a["length_factor"]):
                err.append("anchor_offset_m and length_factor are for bogies")
            if cat == "vehicle":
                if a["size_tiles"] and a["size_tiles"] not in game_rules.SIZE_TILES:
                    err.append(f"a game vehicle is {sorted(game_rules.SIZE_TILES)} tiles long")
                elif a["plan"] and a["plan"] != "rigid":
                    try:
                        if not a["size_tiles"]:
                            raise ValueError(f"plan {a['plan']} needs size_tiles")
                        game_rules.plan_parts(a["plan"], a["size_tiles"])
                    except ValueError as e:
                        err.append(str(e))
                if any(a["clip_below_m"]) and a["size_tiles"] == 1:
                    err.append("clip_below_m: small vehicles get no separate bogies, the body would float")
                if a["split_m"] and a["split_m"] != sorted(a["split_m"]):
                    err.append("split_m must increase from the nose")
            if cat == "building" and not any(a[k] for k in ("height_m", "length_m", "width_m")):
                err.append("building needs height_m, length_m or width_m")
            if a["align"] not in ("auto", "none"):
                err.append("align must be auto|none")
            if a["game_frame"] and cat in ("vehicle", "building", "bogie"):
                err += export_game.check_template(a)
            if err:
                errors.append(f"line {ln} ({aid}): " + "; ".join(err))
            elif not only or aid in only:
                rows.append(a)
    if errors:
        raise PipelineError("assets.csv invalid:\n  " + "\n  ".join(errors))
    if only and (missing := set(only) - {r["id"] for r in rows}):
        raise PipelineError(f"--only ids not in assets.csv: {sorted(missing)}")
    return rows


def run_blender(cfg, job_path: Path, log_path: Path):
    cmd = [cfg["paths"]["blender"], "-b", "--factory-startup", "-noaudio", "--python-exit-code", "1",
           "-P", str(HERE / "blender_stage.py"), "--", str(job_path)]
    with open(log_path, "w", encoding="utf-8") as lf:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace")
        tail = []
        t0 = time.time()
        for line in proc.stdout:
            lf.write(line)
            tail = (tail + [line.rstrip()])[-40:]
            if line.startswith("[blender]"):
                log.info(line.rstrip())
            if time.time() - t0 > cfg["paths"].get("blender_timeout_s", 3600):
                proc.kill()
                raise PipelineError(f"blender timeout; log: {log_path}")
        rc = proc.wait()
    if rc != 0:
        raise PipelineError(f"blender exited {rc}; log: {log_path}\n" + "\n".join(tail[-25:]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "pipeline.toml"))
    ap.add_argument("--only", default="")
    ap.add_argument("--stages", default=",".join(STAGES))
    ap.add_argument("--force", action="store_true", help="redo stages whose outputs exist")
    args = ap.parse_args()

    cfg_path = Path(args.config).resolve()
    cfg = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
    base = cfg_path.parent

    def rel(p):
        p = Path(p)
        return p if p.is_absolute() else base / p

    out = rel(cfg["paths"]["out_root"])
    d = {k: out / k for k in ("models_raw", "jobs", "sprites_raw", "meta", "debug", "sprites", "atlas",
                              "previews", "reports", "logs")}
    for p in d.values():
        p.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(sys.stdout),
                                  logging.FileHandler(d["logs"] / f"run_{stamp}.log", encoding="utf-8")])
    stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    if bad := set(stages) - set(STAGES):
        log.error(f"unknown stages {bad}")
        return 2
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    csv_path = rel(cfg["paths"]["assets_csv"])
    summary = {"started": stamp, "config": str(cfg_path), "assets": {}}
    summary_path = d["reports"] / "summary.json"

    def write_summary():
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    comfy = graph = None
    game_groups = {}
    try:
        assets = load_assets(csv_path, only)
        log.info(f"{len(assets)} assets, stages {stages}, out {out}")
        if "comfy" in stages:
            comfy = comfy_client.Comfy(cfg["comfy"]["url"], cfg["comfy"]["timeout_s"], cfg["comfy"]["poll_s"],
                                       log=log.info)
            comfy.check()
            graph = comfy_client.load_api_workflow(rel(cfg["paths"]["workflow_api"]))
        for a in assets:
            aid = a["id"]
            summary["assets"][aid] = {"status": "running"}
            glb = d["models_raw"] / f"{aid}.glb"
            meta_path = d["meta"] / f"{aid}.json"
            t0 = time.time()
            if "comfy" in stages and (args.force or not glb.exists()):
                img = rel(csv_path.parent / a["image"]) if a["image"] else None
                if not img or not img.exists():
                    raise PipelineError(f"[{aid}] image not found: {img}")
                comfy_client.run_asset(comfy, graph, aid, img, glb, cfg["comfy"])
            if "blender" in stages and (args.force or not meta_path.exists()):
                if not glb.exists():
                    raise PipelineError(f"[{aid}] no model at {glb}; run the comfy stage first")
                job = {"asset": a, "glb": str(glb), "grid": cfg["grid"], "render": cfg["render"],
                       "align": cfg["align"], "class_cfg": cfg["classes"][a["category"]],
                       "meta_path": str(meta_path), "sprites_raw_dir": str(d["sprites_raw"]),
                       "debug_dir": str(d["debug"])}
                job_path = d["jobs"] / f"{aid}.json"
                job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")
                run_blender(cfg, job_path, d["logs"] / f"{aid}_blender.log")
            if "post" in stages:
                if not meta_path.exists():
                    raise PipelineError(f"[{aid}] no render metadata at {meta_path}; run the blender stage")
                info = postprocess.process_asset(meta_path, cfg["post"], {k: str(v) for k, v in d.items()})
                summary["assets"][aid].update(tiles=info["tiles"], final_dims_m=info["final_dims_m"],
                                              compression=info["compression"], warnings=info["warnings"],
                                              preview=str(d["previews"] / f"{aid}.png"))
                for w in info["warnings"]:
                    log.warning(f"[{aid}] {w}")
            if "game" in stages and a["game_frame"]:
                atlas_json = d["atlas"] / f"{aid}.json"
                if not atlas_json.exists():
                    raise PipelineError(f"[{aid}] no sprites at {atlas_json}; run the post stage")
                info = json.loads(atlas_json.read_text(encoding="utf-8"))
                try:
                    touched = export_game.export_asset(a, info,
                                                       rel(cfg["game"]["repo_root"]) / cfg["game"]["art_src"])
                except export_game.GameExportError as e:
                    raise PipelineError(f"[{aid}] {e}") from None
                game_groups.update(touched)
                summary["assets"][aid]["game_groups"] = sorted(touched)
            summary["assets"][aid]["status"] = "ok"
            summary["assets"][aid]["seconds"] = round(time.time() - t0, 1)
            write_summary()
            log.info(f"[{aid}] ok ({time.time() - t0:.0f}s)")
        if game_groups and cfg["game"].get("pack", True):
            export_game.pack(game_groups, cfg["game"], rel(cfg["game"]["repo_root"]), log.info)
    except (PipelineError, comfy_client.ComfyError, export_game.GameExportError, KeyError, OSError) as e:
        failed = next((k for k, v in summary["assets"].items() if v["status"] == "running"), None)
        if failed:
            summary["assets"][failed].update(status="failed", error=str(e))
        summary["result"] = "failed"
        write_summary()
        log.error(f"STOPPED: {e}")
        return 1
    except KeyboardInterrupt:
        if comfy:
            comfy.interrupt()
        summary["result"] = "interrupted"
        write_summary()
        log.error("interrupted")
        return 130
    summary["result"] = "ok"
    write_summary()
    log.info(f"all done -> {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
