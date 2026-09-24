"""Game stage: final sprites -> art-src/<group>/ frames + anchors -> tools/pack-atlas.mjs -> public/assets.

An asset takes part when its `game_frame` in assets.csv names the frame it replaces:
  vehicles  `{f}` is the game facing, e.g. rolling/loco_electric_box_medium_red_body_f{f}
  buildings `{r}` is the rotation (dir 0 -> r0, dir 1 -> r1), e.g. structures/depot_r{r};
            without it the building supplies dir 0 alone, e.g. structures/station_1
Every group written here is marked partial: the game keeps its generator and lays these frames
over it, so frames the pipeline does not supply stay procedural.
"""
import json
import re
import subprocess
from pathlib import Path

# src/art/index.ts; frame keys carry their own prefix, which for the wagons group is rolling/
GROUPS = ("terrain", "props", "track", "structures", "rolling", "wagons", "fx", "icons", "people")
SIZE_TILES = (1, 2, 3)  # src/sim/body.ts SIZE_LEN: small, medium, large


class GameExportError(RuntimeError):
    pass


def group_of(name: str):
    """Atlas group and pack prefix for a frame key."""
    prefix, _, rest = name.partition("/")
    if not rest:
        raise GameExportError(f"game_frame {name!r} needs a '<prefix>/' like the generators' keys")
    group = ("rolling" if rest.startswith("loco_") else "wagons") if prefix == "rolling" else prefix
    if group not in GROUPS:
        raise GameExportError(f"game_frame {name!r}: no atlas group {group!r}; groups are {GROUPS}")
    return group, prefix + "/"


def check_template(category: str, template: str):
    """Validation for assets.csv, before any stage runs. Returns a list of problems."""
    err = []
    if not re.fullmatch(r"[a-z0-9_/{}]+", template):
        err.append("game_frame must be [a-z0-9_/] plus {f} or {r}")
    if category == "vehicle" and "{f}" not in template:
        err.append("vehicle game_frame needs {f} (the facing)")
    if template.startswith("rolling/loco_") and not template.endswith("_body_f{f}"):
        # one render is the whole vehicle; tender, Garratt and Meyer plans are drawn in parts
        err.append("loco game_frame must end in _body_f{f}; only rigid bodies are one sprite")
    if category == "building" and "{f}" in template:
        err.append("building game_frame takes {r}, not {f}")
    if "/" in template.partition("/")[2]:
        err.append("game_frame has one '/', after its prefix")
    try:
        group_of(template)
    except GameExportError as e:
        err.append(str(e))
    return err


def frames_for(asset: dict, info: dict):
    """(frame name, atlas frame) pairs this asset supplies."""
    template, frames = asset["game_frame"], info["frames"]
    if asset["category"] == "vehicle":
        if info["tiles"][0] not in SIZE_TILES:
            raise GameExportError(f"{info['tiles'][0]} tiles long; the game's bodies are {SIZE_TILES}")
        if any(f.get("facing") is None for f in frames):
            raise GameExportError('rendered without game facings; set classes.vehicle.dirs = "game"')
        return [(template.replace("{f}", str(f["facing"])), f) for f in frames]
    if "{r}" in template:
        by_dir = {f["dir"]: f for f in frames}
        if 0 not in by_dir or 1 not in by_dir or by_dir[1]["yaw_deg"] != 90:
            raise GameExportError("{r} needs dir 0 at 0 deg and dir 1 at 90 deg; set classes.building.dirs = 4")
        return [(template.replace("{r}", str(r)), by_dir[r]) for r in (0, 1)]
    return [(template, next(f for f in frames if f["dir"] == 0))]


def export_asset(asset: dict, info: dict, sprite_dir: Path, art_src: Path):
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
    ax, ay = info["anchor_px"]
    for name, fr in pairs:
        group, prefix = group_of(name)
        folder = art_src / group
        folder.mkdir(parents=True, exist_ok=True)
        meta = read_meta(folder)
        owner = meta["frames"].get(name, {}).get("asset")
        if owner and owner != aid:
            raise GameExportError(f"frame {name} already belongs to asset {owner}")
        (folder / f"{name[len(prefix):]}.png").write_bytes((sprite_dir / f"{aid}_d{fr['dir']}.png").read_bytes())
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
