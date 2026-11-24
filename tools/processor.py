"""Image processing engine for the Harlow portfolio curator tool.

Provides artwork detection/cropping, duplicate grouping, and image utilities.
"""

import os
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

try:
    import imagehash
except ImportError:
    imagehash = None


class ArtworkDetector:
    """Detects artwork boundaries in photos and provides crop/straighten."""

    def detect(self, image_path):
        """Detect artwork rectangle in an image.

        Returns dict with:
            found: bool
            confidence: float 0-1
            corners: [[x,y], ...] four corners if found
            crop_rect: [x, y, w, h] bounding rect for simple crop
            rotation: float degrees
            image_size: [w, h]
        """
        img = cv2.imread(str(image_path))
        if img is None:
            return {"found": False, "confidence": 0, "crop_rect": [0, 0, 0, 0],
                    "image_size": [0, 0], "corners": None, "rotation": 0}

        h, w = img.shape[:2]
        result = {
            "found": False,
            "confidence": 0,
            "crop_rect": [0, 0, w, h],
            "image_size": [w, h],
            "corners": None,
            "rotation": 0,
        }

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.bilateralFilter(gray, 9, 75, 75)
        edges = cv2.Canny(blurred, 30, 100)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=2)
        edges = cv2.erode(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return result

        image_area = w * h
        min_area = image_area * 0.15

        best_quad = None
        best_area = 0

        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
            area = cv2.contourArea(cnt)
            if area < min_area:
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)

            if len(approx) == 4 and cv2.isContourConvex(approx):
                if area > best_area:
                    best_quad = approx
                    best_area = area
            elif area > best_area:
                rect = cv2.minAreaRect(cnt)
                box = cv2.boxPoints(rect)
                box_area = cv2.contourArea(box.astype(np.int32))
                fill_ratio = area / max(box_area, 1)
                if fill_ratio > 0.7:
                    best_quad = box.reshape(-1, 1, 2).astype(np.int32)
                    best_area = area

        if best_quad is not None:
            corners = best_quad.reshape(4, 2).tolist()
            corners = self._order_points(np.array(corners, dtype=np.float32))

            rect = cv2.boundingRect(best_quad)
            x, y, rw, rh = rect
            x = max(0, x)
            y = max(0, y)
            rw = min(rw, w - x)
            rh = min(rh, h - y)

            coverage = (rw * rh) / image_area
            confidence = min(coverage * 1.5, 1.0)
            if coverage > 0.9:
                confidence = max(confidence, 0.95)

            min_rect = cv2.minAreaRect(best_quad)
            angle = min_rect[-1]
            if angle < -45:
                angle += 90

            result.update({
                "found": True,
                "confidence": round(confidence, 2),
                "crop_rect": [int(x), int(y), int(rw), int(rh)],
                "corners": corners.tolist(),
                "rotation": round(angle, 1),
            })

        return result

    def _order_points(self, pts):
        """Order points: top-left, top-right, bottom-right, bottom-left."""
        rect = np.zeros((4, 2), dtype=np.float32)
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        d = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(d)]
        rect[3] = pts[np.argmax(d)]
        return rect

    def crop_and_straighten(self, image_path, corners=None, crop_rect=None):
        """Crop and straighten artwork from image.

        Args:
            image_path: path to source image
            corners: 4 corner points for perspective transform
            crop_rect: [x, y, w, h] for simple rectangular crop

        Returns:
            PIL Image of cropped artwork, or None on failure
        """
        img = cv2.imread(str(image_path))
        if img is None:
            return None

        if corners is not None:
            pts = np.array(corners, dtype=np.float32)
            pts = self._order_points(pts)

            widthA = np.linalg.norm(pts[2] - pts[3])
            widthB = np.linalg.norm(pts[1] - pts[0])
            maxW = int(max(widthA, widthB))

            heightA = np.linalg.norm(pts[1] - pts[2])
            heightB = np.linalg.norm(pts[0] - pts[3])
            maxH = int(max(heightA, heightB))

            if maxW < 10 or maxH < 10:
                return None

            dst = np.array([
                [0, 0], [maxW - 1, 0],
                [maxW - 1, maxH - 1], [0, maxH - 1]
            ], dtype=np.float32)

            M = cv2.getPerspectiveTransform(pts, dst)
            warped = cv2.warpPerspective(img, M, (maxW, maxH))
            rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
            return Image.fromarray(rgb)

        elif crop_rect is not None:
            x, y, w, h = [int(v) for v in crop_rect]
            ih, iw = img.shape[:2]
            x = max(0, min(x, iw - 1))
            y = max(0, min(y, ih - 1))
            w = max(1, min(w, iw - x))
            h = max(1, min(h, ih - y))
            cropped = img[y:y+h, x:x+w]
            rgb = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)
            return Image.fromarray(rgb)

        return None


class DuplicateGrouper:
    """Groups similar images using perceptual hashing."""

    def __init__(self, threshold=12):
        self.threshold = threshold

    def group(self, image_paths):
        """Group similar images together.

        Args:
            image_paths: list of image file paths

        Returns:
            list of groups, each group is a list of paths
        """
        if imagehash is None:
            return [[p] for p in image_paths]

        hashes = {}
        for path in image_paths:
            try:
                img = Image.open(path)
                h = imagehash.phash(img, hash_size=16)
                hashes[path] = h
            except Exception:
                hashes[path] = None

        paths = list(hashes.keys())
        n = len(paths)
        parent = list(range(n))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        for i in range(n):
            for j in range(i + 1, n):
                hi, hj = hashes[paths[i]], hashes[paths[j]]
                if hi is not None and hj is not None:
                    if hi - hj <= self.threshold:
                        union(i, j)

        groups_map = {}
        for i in range(n):
            root = find(i)
            groups_map.setdefault(root, []).append(paths[i])

        groups = list(groups_map.values())
        groups.sort(key=lambda g: g[0])
        return groups


class ImageProcessor:
    """Image utility functions."""

    @staticmethod
    def create_thumbnail(image_path, max_size=400):
        """Create a thumbnail, returning PIL Image."""
        img = Image.open(image_path)
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        return img

    @staticmethod
    def save_cropped(source_path, dest_path, crop_rect=None, corners=None):
        """Crop image and save to dest_path.

        Args:
            source_path: original image
            dest_path: where to save cropped version
            crop_rect: [x, y, w, h]
            corners: 4 corner points for perspective transform
        """
        detector = ArtworkDetector()
        cropped = detector.crop_and_straighten(source_path, corners=corners, crop_rect=crop_rect)
        if cropped is None:
            shutil.copy2(source_path, dest_path)
            return False
        cropped.save(str(dest_path), quality=90)
        return True

    @staticmethod
    def save_hero(source_path, dest_dir, crop_rect=None):
        """Save a hero version of the image.

        Args:
            source_path: image to use
            dest_dir: directory to save _hero.webp in
            crop_rect: optional [x, y, w, h] crop

        Returns:
            path to saved hero image
        """
        hero_path = Path(dest_dir) / "_hero.webp"
        img = Image.open(source_path)

        if crop_rect:
            x, y, w, h = [int(v) for v in crop_rect]
            img = img.crop((x, y, x + w, y + h))

        img.save(str(hero_path), "WEBP", quality=85)
        return str(hero_path)
