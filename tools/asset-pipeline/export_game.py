"""Game stage: final sprites -> art-src/<group>/ frames + anchors -> tools/pack-atlas.mjs -> public/assets.

An asset takes part when its `game_frame` in assets.csv names the frame it replaces:
  vehicles  `{f}` is the game facing and `{part}` the body part of its plan,
            e.g. rolling/loco_steam_std_medium_black_{part}_f{f}, rolling/wagon_box_small_iron_f{f}
  bogies    `{f}`, e.g. rolling/bogie_y25_f{f}; the style after the kind is the vehicles' bogieStyle
  buildings `{r}` is the rotation (dir 0 -> r0, dir 1 -> r1), e.g. structures/depot_r{r};
            without it the building supplies dir 0 alone, e.g. structures/station_1
Every group written here is marked partial: the game keeps its generator and lays these frames
over it, so frames the pipeline does not supply stay procedural.
"""
import json
import re
import subprocess
from pathlib import Path

import game_rules


class GameExportError(RuntimeError):
    pass


def group_of(name: str):
    """Atlas group and pack prefix for a frame key; frame keys carry their own prefix, which for
    the wagons group (wagons, loads, bogies) is rolling/."""
    prefix, _, rest = name.partition("/")
    if not rest:
        raise GameExportError(f"game_frame {name!r} needs a '<prefix>/' like the generators' keys")
    group = ("rolling" if rest.startswith("loco_") else "wagons") if prefix == "rolling" else prefix
    if group not in game_rules.GROUPS:
        raise GameExportError(f"game_frame {name!r}: no atlas group {group!r}; groups are {game_rules.GROUPS}")
    return group, prefix + "/"


def check_template(a: dict):
    """Validation for an assets.csv row, before any stage runs. Returns a list of problems."""
    category, template, plan = a["category"], a["game_frame"], a.get("plan") or "rigid"
    err = []
    if not re.fullmatch(r"[a-z0-9_/{}]+", template):
        err.append("game_frame must be [a-z0-9_/] plus {f}, {part} or {r}")
    if "/" in template.partition("/")[2]:
        err.append("game_frame has one '/', after its prefix")
    if category in ("vehicle", "bogie") and "{f}" not in template:
        err.append(f"{category} game_frame needs {{f}} (the facing)")
    if category == "building" and ("{f}" in template or "{part}" in template):
        err.append("building game_frame takes {r} only")
    if category == "vehicle":
        if template.startswith("rolling/loco_"):
            # the renderer asks for rolling/loco_<body>_<size>_<paint>_<part>_f<facing>
            if not (template.endswith("_{part}_f{f}") or (plan == "rigid" and template.endswith("_body_f{f}"))):
                err.append("loco game_frame must end in _{part}_f{f} (or _body_f{f} for a rigid plan)")
        elif template.startswith("rolling/wagon_"):
            if plan != "rigid" or "{part}" in template:
                err.append("wagons are one rigid body: plan rigid, no {part}")
        else:
            err.append("vehicle game_frame is rolling/loco_* or rolling/wagon_*")
    if category == "bogie":
        kinds = "|".join(game_rules.BOGIE_KINDS)
        if not re.fullmatch(rf"rolling/({kinds})(_[a-z0-9_]+)?_f\{{f\}}", template):
            err.append(f"bogie game_frame is rolling/<{kinds}>[_<style>]_f{{f}}")
    try:
        group_of(template)
    except GameExportError as e:
        err.append(str(e))
    return err


def frames_for(asset: dict, info: dict):
    """(frame name, atlas frame) pairs this asset supplies."""
    template, frames = asset["game_frame"], info["frames"]
    if asset["category"] in ("vehicle", "bogie"):
        if any(f.get("facing") is None for f in frames):
            raise GameExportError(f'rendered without game facings; set classes.{asset["category"]}.dirs = "game"')
        return [(template.replace("{part}", f["part"] or "").replace("{f}", str(f["facing"])), f) for f in frames]
    if "{r}" in template:
        by_dir = {f["dir"]: f for f in frames}
        if 0 not in by_dir or 1 not in by_dir or by_dir[1]["yaw_deg"] != 90:
            raise GameExportError("{r} needs dir 0 at 0 deg and dir 1 at 90 deg; set classes.building.dirs = 4")
        return [(template.replace("{r}", str(r)), by_dir[r]) for r in (0, 1)]
    return [(template, next(f for f in frames if f["dir"] == 0))]


def export_asset(asset: dict, info: dict, art_src: Path):
    """Copy the asset's sprites into art-src and record their anchors. Returns the groups touched."""
    aid = asset["id"]
    pairs = frames_for(asset, info)
    groups = {}
    for name, _ in pairs:
        group, prefix = group_of(name)
        groups.setdefault(group, prefix)
        if groups[group] != prefix:
            raise GameExportError(f"group {group} mixes prefixes {groups[group]} and {prefix}")
    for group in groups:
        release(art_src / group, aid)
    for name, fr in pairs:
        group, prefix = group_of(name)
        folder = art_src / group
        folder.mkdir(parents=True, exist_ok=True)
        meta = read_meta(folder)
        owner = meta["frames"].get(name, {}).get("asset")
        if owner and owner != aid:
            raise GameExportError(f"frame {name} already belongs to asset {owner}")
        (folder / f"{name[len(prefix):]}.png").write_bytes(Path(fr["file"]).read_bytes())
        ax, ay = fr["anchor_px"]
        meta["frames"][name] = {"ax": ax, "ay": ay, "asset": aid}
        write_meta(folder, meta)
    return groups


def release(folder: Path, aid: str):
    """Drop the frames an earlier run of this asset wrote, so a renamed game_frame leaves nothing behind."""
    if not (folder / "atlas.json").exists():
        return
    meta = read_meta(folder)
    for name in [n for n, f in meta["frames"].items() if f.get("asset") == aid]:
        (folder / f"{name.partition('/')[2]}.png").unlink(missing_ok=True)
        del meta["frames"][name]
    write_meta(folder, meta)


def read_meta(folder: Path):
    p = folder / "atlas.json"
    meta = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    meta.setdefault("frames", {})
    meta["partial"] = True
    return meta


def write_meta(folder: Path, meta: dict):
    meta["frames"] = dict(sorted(meta["frames"].items()))
    (folder / "atlas.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def pack(groups: dict, gcfg: dict, repo: Path, log):
    """Run the game's packer once per touched group; fails loudly like every other stage."""
    for group, prefix in sorted(groups.items()):
        cmd = [gcfg.get("node", "node"), "tools/pack-atlas.mjs", group, "--prefix", prefix,
               "--src", str(Path(gcfg["art_src"]) / group), "--out", gcfg["out"]]
        proc = subprocess.run(cmd, cwd=repo, capture_output=True, text=True)
        for line in (proc.stdout + proc.stderr).splitlines():
            log(f"[pack] {line}")
        if proc.returncode != 0:
            raise GameExportError(f"pack-atlas {group} exited {proc.returncode}")
