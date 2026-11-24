"""HTTP API handler for the Harlow portfolio curator tool."""

import io
import json
import os
import re
import shutil
import subprocess
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

from processor import ArtworkDetector, DuplicateGrouper, ImageProcessor
from PIL import Image

PROJECT_ROOT = None  # Set by curator.py before starting server
STATE_FILE = Path(__file__).parent / ".curator-state.json"
THUMB_CACHE = {}


def _resolve(rel_path):
    """Resolve a relative path against the project root."""
    return Path(PROJECT_ROOT) / rel_path


def _load_works():
    with open(_resolve("works.json"), "r") as f:
        return json.load(f)


def _save_works(data):
    with open(_resolve("works.json"), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def _load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {}


def _save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def _category_dir(cat_id):
    """Find the image directory for a category ID."""
    works = _load_works()
    for cat in works:
        if cat["id"] == cat_id:
            if cat["images"]:
                first_image = cat["images"][0]
                return _resolve(str(Path(first_image).parent))
            folder_name = cat.get("label", cat_id).replace(" ", "_")
            return _resolve("images") / folder_name
    return None


_INTERNAL_PREFIXES = ("_originals", "_weeds", "_duplicates_of_", "_hero.")

def _list_images(directory):
    """List image files in directory, excluding curator internal files."""
    exts = {".webp", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".nef"}
    images = []
    d = Path(directory)
    if not d.exists():
        return images
    for f in sorted(d.iterdir()):
        if f.is_dir():
            continue
        if f.suffix.lower() not in exts:
            continue
        if f.name.startswith(_INTERNAL_PREFIXES):
            continue
        images.append(f)
    return images


class CuratorHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        if any(x in (args[0] if args else '') for x in ('POST', '500', '404')):
            print(format % args)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        self._send_json({"error": message}, status)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _serve_file(self, filepath, content_type=None):
        filepath = Path(filepath)
        if not filepath.exists():
            self._send_error(404, "File not found")
            return
        if content_type is None:
            ext = filepath.suffix.lower()
            content_type = {
                ".html": "text/html",
                ".css": "text/css",
                ".js": "application/javascript",
                ".json": "application/json",
                ".webp": "image/webp",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".svg": "image/svg+xml",
            }.get(ext, "application/octet-stream")
        data = filepath.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _serve_thumbnail(self, image_path):
        image_path = Path(image_path)
        if not image_path.exists():
            self._send_error(404, "Image not found")
            return

        cache_key = str(image_path)
        mtime = image_path.stat().st_mtime
        if cache_key in THUMB_CACHE and THUMB_CACHE[cache_key][0] == mtime:
            data = THUMB_CACHE[cache_key][1]
        else:
            try:
                thumb = ImageProcessor.create_thumbnail(image_path, max_size=400)
                buf = io.BytesIO()
                thumb.save(buf, "WEBP", quality=70)
                data = buf.getvalue()
                THUMB_CACHE[cache_key] = (mtime, data)
            except Exception:
                self._send_error(500, "Failed to create thumbnail")
                return

        self.send_response(200)
        self.send_header("Content-Type", "image/webp")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=60")
        self.end_headers()
        self.wfile.write(data)

    # ── Route dispatch ──────────────────────────────────────────────

    def do_GET(self):
        path = unquote(self.path)
        try:
            if path == "/" or path == "":
                self._serve_file(Path(__file__).parent / "curator-ui.html")

            elif path == "/api/categories":
                self._handle_categories()

            elif m := re.match(r"/api/category/([^/]+)/images", path):
                self._handle_images(m.group(1))

            elif m := re.match(r"/api/category/([^/]+)/detect", path):
                self._handle_detect(m.group(1))

            elif m := re.match(r"/api/category/([^/]+)/duplicates", path):
                self._handle_duplicates(m.group(1))

            elif path.startswith("/thumb/"):
                rel = path[7:]
                self._serve_thumbnail(_resolve(rel))

            elif path.startswith("/image/"):
                rel = path[7:]
                self._serve_file(_resolve(rel))

            else:
                self._send_error(404, "Not found")
        except Exception as e:
            traceback.print_exc()
            self._send_error(500, str(e))

    def do_POST(self):
        path = unquote(self.path)
        try:
            if m := re.match(r"/api/category/([^/]+)/crop", path):
                self._handle_crop(m.group(1))

            elif m := re.match(r"/api/category/([^/]+)/deduplicate", path):
                self._handle_deduplicate(m.group(1))

            elif m := re.match(r"/api/category/([^/]+)/hero", path):
                self._handle_hero(m.group(1))

            elif m := re.match(r"/api/category/([^/]+)/optimize", path):
                self._handle_optimize(m.group(1))

            elif m := re.match(r"/api/category/([^/]+)/finalize", path):
                self._handle_finalize(m.group(1))

            elif m := re.match(r"/api/category/([^/]+)/weed", path):
                self._handle_weed(m.group(1))

            else:
                self._send_error(404, "Not found")
        except Exception as e:
            traceback.print_exc()
            self._send_error(500, str(e))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── GET handlers ────────────────────────────────────────────────

    def _handle_categories(self):
        works = _load_works()
        state = _load_state()
        cats = []
        for cat in works:
            cat_state = state.get(cat["id"], {})
            d = _category_dir(cat["id"])
            image_count = len(_list_images(d)) if d and d.exists() else 0
            cats.append({
                "id": cat["id"],
                "label": cat["label"],
                "featured": cat.get("featured", ""),
                "imageCount": image_count,
                "step": cat_state.get("step", 0),
                "completed": cat_state.get("completed", False),
            })
        self._send_json(cats)

    def _handle_images(self, cat_id):
        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return
        images = _list_images(d)
        result = []
        for img in images:
            rel = os.path.relpath(img, PROJECT_ROOT)
            result.append({
                "path": rel,
                "name": img.name,
                "size": img.stat().st_size,
            })
        self._send_json(result)

    def _handle_detect(self, cat_id):
        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return
        images = _list_images(d)
        detector = ArtworkDetector()
        results = []
        for img in images:
            rel = os.path.relpath(img, PROJECT_ROOT)
            det = detector.detect(str(img))
            det["path"] = rel
            det["name"] = img.name
            results.append(det)
        self._send_json(results)

    def _handle_duplicates(self, cat_id):
        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return
        images = _list_images(d)
        grouper = DuplicateGrouper()
        groups = grouper.group([str(p) for p in images])

        result = []
        for group in groups:
            group_data = []
            for path in group:
                p = Path(path)
                rel = os.path.relpath(p, PROJECT_ROOT)
                group_data.append({
                    "path": rel,
                    "name": p.name,
                    "size": p.stat().st_size,
                })
            result.append(group_data)
        self._send_json(result)

    # ── POST handlers ───────────────────────────────────────────────

    def _handle_crop(self, cat_id):
        """Apply crops to images. Body: {crops: [{path, corners?, skip?, weed?}]}"""
        body = self._read_body()
        crops = body.get("crops", [])

        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return

        originals_dir = d / "_originals"
        originals_dir.mkdir(exist_ok=True)
        weeds_dir = d / "_weeds"

        applied = 0
        skipped = 0
        weeded = 0
        for crop_info in crops:
            rel_path = crop_info["path"]
            full_path = _resolve(rel_path)
            if not full_path.exists():
                continue

            # Weed: move to _weeds/ subfolder
            if crop_info.get("weed"):
                weeds_dir.mkdir(exist_ok=True)
                shutil.move(str(full_path), str(weeds_dir / full_path.name))
                weeded += 1
                if str(full_path) in THUMB_CACHE:
                    del THUMB_CACHE[str(full_path)]
                continue

            if crop_info.get("skip"):
                skipped += 1
                continue

            backup = originals_dir / full_path.name
            if not backup.exists():
                shutil.copy2(full_path, backup)

            success = ImageProcessor.save_cropped(
                str(backup),
                str(full_path),
                crop_rect=crop_info.get("crop_rect"),
                corners=crop_info.get("corners"),
            )
            if success:
                applied += 1
                if str(full_path) in THUMB_CACHE:
                    del THUMB_CACHE[str(full_path)]

        state = _load_state()
        state.setdefault(cat_id, {})["step"] = 1
        _save_state(state)

        self._send_json({"applied": applied, "skipped": skipped, "weeded": weeded})

    def _handle_deduplicate(self, cat_id):
        """Remove duplicates. Body: {groups: [{keep: path, remove: [paths]}]}"""
        body = self._read_body()
        groups = body.get("groups", [])

        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return

        removed = 0
        for group in groups:
            keep_path = group.get("keep")
            remove_paths = group.get("remove", [])
            if not keep_path or not remove_paths:
                continue

            keep_name = Path(keep_path).stem
            dup_dir = d / f"_duplicates_of_{keep_name}"
            dup_dir.mkdir(exist_ok=True)

            for rel_path in remove_paths:
                full_path = _resolve(rel_path)
                if full_path.exists():
                    shutil.move(str(full_path), str(dup_dir / full_path.name))
                    removed += 1

        state = _load_state()
        state.setdefault(cat_id, {})["step"] = 2
        _save_state(state)

        self._send_json({"removed": removed})

    def _handle_hero(self, cat_id):
        """Set hero image. Body: {path: str, crop_rect?: [x,y,w,h]}"""
        body = self._read_body()
        image_path = body.get("path")
        crop_rect = body.get("crop_rect")

        if not image_path:
            self._send_error(400, "Missing path")
            return

        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return

        full_path = _resolve(image_path)
        if not full_path.exists():
            self._send_error(404, f"Image not found: {image_path}")
            return

        # If a custom crop is specified, save a cropped _hero.webp
        # Otherwise just use the source image directly as featured
        if crop_rect:
            hero_path = ImageProcessor.save_hero(str(full_path), str(d), crop_rect)
            hero_rel = os.path.relpath(hero_path, PROJECT_ROOT)
        else:
            hero_rel = image_path

        state = _load_state()
        state.setdefault(cat_id, {})["step"] = 3
        state[cat_id]["hero"] = hero_rel
        state[cat_id]["hero_source"] = image_path
        _save_state(state)

        self._send_json({"hero": hero_rel})

    def _handle_optimize(self, cat_id):
        """Optimize images: resize to max 1920px, convert to webp, add watermark."""
        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return

        # Only optimize web-friendly formats; skip RAW files
        _optimizable = {".webp", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff"}
        images = [f for f in _list_images(d) if f.suffix.lower() in _optimizable]
        if not images:
            self._send_json({"optimized": 0, "skipped_raw": 0, "errors": []})
            return

        max_size = 1920
        quality = 82
        watermark = "\u00a9 Sarah Harlow"
        optimized = 0
        errors = []

        for img_path in images:
            out_name = img_path.stem + ".webp"
            out_path = d / out_name

            try:
                cmd = [
                    "magick", str(img_path),
                    "-auto-orient",
                    "-resize", f"{max_size}x{max_size}>",
                    "-strip",
                    "-quality", str(quality),
                    "-gravity", "southeast",
                    "-fill", "rgba(255,255,255,0.35)",
                    "-undercolor", "rgba(0,0,0,0.18)",
                    "-pointsize", "28",
                    "-annotate", "+20+20", watermark,
                    str(out_path),
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                if result.returncode != 0:
                    errors.append(f"{img_path.name}: {result.stderr.strip()}")
                    continue

                # If the original was a different format, remove it
                if img_path.suffix.lower() != ".webp" and out_path.exists() and img_path != out_path:
                    img_path.unlink()

                optimized += 1

                # Invalidate thumbnail cache
                for key in list(THUMB_CACHE.keys()):
                    if img_path.name in key or out_name in key:
                        del THUMB_CACHE[key]

            except subprocess.TimeoutExpired:
                errors.append(f"{img_path.name}: timed out")
            except Exception as e:
                errors.append(f"{img_path.name}: {e}")

        state = _load_state()
        state.setdefault(cat_id, {})["step"] = 4
        _save_state(state)

        self._send_json({"optimized": optimized, "errors": errors})

    def _handle_finalize(self, cat_id):
        """Update works.json with current image list and hero."""
        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return

        images = _list_images(d)
        image_rels = [os.path.relpath(str(img), PROJECT_ROOT) for img in images]

        state = _load_state()
        cat_state = state.get(cat_id, {})
        hero = cat_state.get("hero")

        # After optimize, the hero source may have been converted to .webp
        if hero and not _resolve(hero).exists():
            webp_hero = Path(hero).with_suffix(".webp")
            if _resolve(str(webp_hero)).exists():
                hero = str(webp_hero)

        works = _load_works()
        for cat in works:
            if cat["id"] == cat_id:
                old_images = cat.get("images", [])
                cat["images"] = image_rels
                if hero and hero in image_rels:
                    cat["featured"] = hero
                elif hero:
                    cat["featured"] = hero
                elif image_rels:
                    cat["featured"] = image_rels[0]

                _save_works(works)

                cat_state["step"] = 5
                cat_state["completed"] = True
                state[cat_id] = cat_state
                _save_state(state)

                self._send_json({
                    "category": cat_id,
                    "images_before": len(old_images),
                    "images_after": len(image_rels),
                    "featured": cat["featured"],
                })
                return

        self._send_error(404, f"Category {cat_id} not in works.json")

    def _handle_weed(self, cat_id):
        """Move a single image to _weeds/. Body: {path: str}"""
        body = self._read_body()
        image_path = body.get("path")
        if not image_path:
            self._send_error(400, "Missing path")
            return

        d = _category_dir(cat_id)
        if not d:
            self._send_error(404, f"Category {cat_id} not found")
            return

        full_path = _resolve(image_path)
        if not full_path.exists():
            self._send_error(404, f"Image not found: {image_path}")
            return

        weeds_dir = d / "_weeds"
        weeds_dir.mkdir(exist_ok=True)
        shutil.move(str(full_path), str(weeds_dir / full_path.name))

        if str(full_path) in THUMB_CACHE:
            del THUMB_CACHE[str(full_path)]

        self._send_json({"weeded": image_path})
