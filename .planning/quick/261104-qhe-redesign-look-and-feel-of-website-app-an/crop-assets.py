"""Crop brand raster assets out of mockups/mockup-16.png into apps/web/public/brand.

Run from the repo root:
  python3 -I .planning/quick/261104-qhe-redesign-look-and-feel-of-website-app-an/crop-assets.py
"""
import os
import sys
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(HERE, "mockups", "mockup-16.png")
OUT = os.path.join(ROOT, "apps", "web", "public", "brand")

# (name, box) boxes are (left, top, right, bottom) in mockup-16 pixels.
PHOTOS = [
    ("hero-canal-laptop", (14, 6, 1664, 396)),
    ("skyline-banner", (14, 428, 1660, 564)),
    ("houses-row", (408, 580, 718, 764)),
]
KEYS_BOX = (44, 576, 338, 768)


def save_photo(img, name):
    img = img.convert("RGB")
    img.save(os.path.join(OUT, name + ".webp"), "WEBP", quality=82, method=6)
    img.save(os.path.join(OUT, name + ".jpg"), "JPEG", quality=82, optimize=True, progressive=True)


def near_white_to_alpha(img, lo=228, hi=250):
    """Map near-white pixels to transparent with a soft ramp between lo and hi."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            m = min(r, g, b)
            if m >= hi:
                px[x, y] = (r, g, b, 0)
            elif m > lo:
                alpha = int(255 * (hi - m) / (hi - lo))
                px[x, y] = (r, g, b, min(a, alpha))
    # soften the edge a little so the cut-out does not look jagged
    alpha = img.getchannel("A").filter(ImageFilter.GaussianBlur(0.6))
    img.putalpha(alpha)
    return img


def main():
    if not os.path.exists(SRC):
        sys.exit("missing " + SRC)
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC)
    print("source size", src.size)
    for name, box in PHOTOS:
        save_photo(src.crop(box), name)
    keys = near_white_to_alpha(src.crop(KEYS_BOX))
    keys.save(os.path.join(OUT, "keys-house.png"), optimize=True)
    keys.save(os.path.join(OUT, "keys-house.webp"), "WEBP", quality=85, method=6)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == "__main__":
    main()
