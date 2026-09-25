"""ComfyUI HTTP API stage: upload image -> patch API-format workflow -> queue -> wait -> download GLB.

Stdlib only. Every failure raises ComfyError with the server's own message.
"""
import copy
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

MODEL_SWITCH = {"pixal3d": False, "trellis2": True}


class ComfyError(RuntimeError):
    pass


class Comfy:
    def __init__(self, url, timeout_s=1800, poll_s=2.0, log=print):
        self.url = url.rstrip("/")
        self.timeout_s = timeout_s
        self.poll_s = poll_s
        self.client_id = uuid.uuid4().hex
        self.log = log

    # ---------- transport ----------
    def _req(self, method, path, data=None, headers=None, timeout=120):
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            raise ComfyError(f"{method} {path} -> HTTP {e.code}: {body[:4000]}") from None
        except urllib.error.URLError as e:
            raise ComfyError(f"cannot reach ComfyUI at {self.url}: {e.reason}. ComfyUI Desktop listens on port "
                             f"8000 by default, a manual install on 8188; set comfy.url") from None

    def get_json(self, path):
        return json.loads(self._req("GET", path))

    def check(self):
        stats = self.get_json("/system_stats")
        dev = (stats.get("devices") or [{}])[0]
        self.log(f"ComfyUI {stats.get('system', {}).get('comfyui_version', '?')} "
                 f"device={dev.get('name', '?')} vram_free={dev.get('vram_free', '?')}")
        return stats

    def interrupt(self):
        try:
            self._req("POST", "/interrupt", data=b"")
        except ComfyError:
            pass

    # ---------- operations ----------
    def upload_image(self, path: Path, subfolder="pipeline"):
        boundary = uuid.uuid4().hex
        parts = []
        for name, value in (("overwrite", "true"), ("type", "input"), ("subfolder", subfolder)):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n".encode()
            + path.read_bytes() + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        resp = json.loads(self._req("POST", "/upload/image", b"".join(parts),
                                    {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
        sub = resp.get("subfolder", "")
        return f"{sub}/{resp['name']}" if sub else resp["name"]

    def queue(self, graph):
        body = json.dumps({"prompt": graph, "client_id": self.client_id}).encode()
        resp = json.loads(self._req("POST", "/prompt", body, {"Content-Type": "application/json"}))
        if resp.get("node_errors"):
            raise ComfyError("workflow validation failed:\n" + json.dumps(resp["node_errors"], indent=2)[:4000])
        return resp["prompt_id"]

    def wait(self, prompt_id):
        t0 = time.time()
        while True:
            hist = self.get_json(f"/history/{prompt_id}")
            if prompt_id in hist:
                entry = hist[prompt_id]
                status = entry.get("status", {})
                errors = [m[1] for m in status.get("messages", []) if m and m[0] in ("execution_error", "execution_interrupted")]
                if status.get("status_str") == "error" or errors:
                    raise ComfyError(format_exec_error(errors))
                return entry
            if time.time() - t0 > self.timeout_s:
                self.interrupt()
                raise ComfyError(f"timeout after {self.timeout_s}s (prompt {prompt_id}); sent /interrupt")
            time.sleep(self.poll_s)

    def download(self, info, dest: Path):
        q = urllib.parse.urlencode({"filename": info["filename"], "subfolder": info.get("subfolder", ""),
                                    "type": info.get("type", "output")})
        data = self._req("GET", f"/view?{q}", timeout=600)
        if len(data) < 1024:
            raise ComfyError(f"downloaded file suspiciously small ({len(data)} bytes): {info}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return dest


def format_exec_error(errors):
    if not errors:
        return "execution failed (no error message in history)"
    e = errors[0]
    tb = "".join(e.get("traceback", [])[-6:]) if isinstance(e.get("traceback"), list) else ""
    return (f"node {e.get('node_id')} ({e.get('node_type')}): "
            f"{e.get('exception_type', '')} {e.get('exception_message', e)}\n{tb}").strip()


# ---------- workflow patching ----------
def load_api_workflow(path: Path):
    graph = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(graph, dict) and "nodes" in graph and "links" in graph:
        raise ComfyError(f"{path} is the UI format. In ComfyUI use Workflow -> Export (API) and point "
                         f"paths.workflow_api at that file.")
    if not all(isinstance(v, dict) and "class_type" in v for v in graph.values()):
        raise ComfyError(f"{path} is not an API-format workflow")
    return graph


def _find(graph, node_id, class_type, required=True):
    if node_id:
        if node_id not in graph:
            raise ComfyError(f"node {node_id} not in workflow")
        return node_id
    hits = [k for k, v in graph.items() if v["class_type"] == class_type]
    if len(hits) == 1:
        return hits[0]
    if not hits and not required:
        return None
    raise ComfyError(f"expected exactly one {class_type} node, found {hits}; set its id in pipeline.toml")


def _set_input(graph, nid, name, value):
    inputs = graph[nid]["inputs"]
    if name not in inputs:
        raise ComfyError(f"node {nid} ({graph[nid]['class_type']}) has no input '{name}'; has {list(inputs)}")
    if isinstance(inputs[name], list):
        raise ComfyError(f"node {nid}.{name} is a link, not a value")
    inputs[name] = value


def prepare_graph(base, image_value, prefix, ccfg):
    g = copy.deepcopy(base)
    load_id = _find(g, ccfg.get("load_image_node"), "LoadImage")
    save_id = _find(g, ccfg.get("save_node"), "Save3DAdvanced")
    _set_input(g, load_id, "image", image_value)
    _set_input(g, save_id, "filename_prefix", prefix)
    model = ccfg.get("model", "keep")
    if model != "keep":
        if model not in MODEL_SWITCH:
            raise ComfyError(f"comfy.model must be keep|pixal3d|trellis2, got {model}")
        sw = _find(g, ccfg.get("switch_node"), "PrimitiveBoolean")
        _set_input(g, sw, "value", MODEL_SWITCH[model])
    for key, value in (ccfg.get("set") or {}).items():
        nid, _, name = key.partition(".")
        if nid not in g:
            raise ComfyError(f"comfy.set: node {nid} not in workflow")
        _set_input(g, nid, name, value)
    return g, save_id


def find_model_file(outputs, save_id):
    found = []

    def walk(obj, nid):
        if isinstance(obj, dict):
            fn = obj.get("filename")
            if isinstance(fn, str) and fn.lower().endswith((".glb", ".gltf")):
                found.append((nid, obj))
            for v in obj.values():
                walk(v, nid)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, nid)

    for nid, out in outputs.items():
        walk(out, nid)
    ranked = sorted(found, key=lambda x: (x[0] != save_id, x[1].get("type") != "output"))
    if not ranked:
        raise ComfyError(f"no .glb in outputs of prompt; output nodes: {list(outputs)}")
    return ranked[0][1]


def run_asset(comfy, base_graph, asset_id, image_path: Path, dest: Path, ccfg):
    image_value = comfy.upload_image(image_path)
    graph, save_id = prepare_graph(base_graph, image_value, f"pipeline/{asset_id}", ccfg)
    pid = comfy.queue(graph)
    comfy.log(f"[{asset_id}] queued prompt {pid}")
    t0 = time.time()
    entry = comfy.wait(pid)
    info = find_model_file(entry.get("outputs", {}), save_id)
    comfy.download(info, dest)
    comfy.log(f"[{asset_id}] 3D done in {time.time() - t0:.0f}s -> {dest}")
    return dest
