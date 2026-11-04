"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { DashboardPreview } from "./DashboardPreview";

// Size of the hero photo (public/brand/hero-canal-laptop.webp) in pixels.
const PHOTO_W = 1650;
const PHOTO_H = 390;
// Corners of the blank laptop screen in that photo: TL, TR, BR, BL.
const SCREEN: Array<[number, number]> = [
  [1081.5, 105],
  [1384, 74],
  [1349, 328.5],
  [1030, 318.5],
];
// Horizontal centre of the laptop screen in photo pixels.
const SCREEN_CX = 1205;
// Natural size of the preview rendered onto the screen before the transform.
const PREVIEW_W = 880;
const PREVIEW_H = 670;

/**
 * CSS matrix3d that maps the rectangle (0,0)-(w,h) onto the quadrilateral
 * `q` (TL, TR, BR, BL). Standard square-to-quad projective mapping.
 */
function quadMatrix3d(w: number, h: number, q: Array<[number, number]>): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  // Column-major order, unit square scaled to w x h.
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(8)).join(",")})`;
}

const SCREEN_MATRIX = quadMatrix3d(PREVIEW_W, PREVIEW_H, SCREEN);

type Layout = { s: number; x: number; y: number };

/**
 * Where to draw the photo inside a box of w x h.
 * "wide": the photo sits at the bottom right of the hero, scaled so the
 * laptop and mug fit the right half, with the laptop at about 76% across.
 * "cover": the photo covers the box with the laptop centred.
 */
function layoutFor(w: number, h: number, mode: "wide" | "cover"): Layout {
  if (mode === "wide") {
    const s = Math.min(h / PHOTO_H, w / 1080);
    let x = 0.76 * w - SCREEN_CX * s;
    x = Math.max(x, w - PHOTO_W * s); // never leave a gap on the right
    return { s, x, y: h - PHOTO_H * s };
  }
  const s = Math.max(h / PHOTO_H, w / PHOTO_W);
  let x = 0.5 * w - SCREEN_CX * s;
  x = Math.min(0, Math.max(x, w - PHOTO_W * s));
  return { s, x, y: (h - PHOTO_H * s) / 2 };
}

/**
 * The canal photo with the laptop, with the Rentular preview drawn onto the
 * blank laptop screen in perspective. Purely decorative.
 */
export default function HeroShowcase({
  mode,
  priority = false,
  className = "",
  style,
}: {
  mode: "wide" | "cover";
  priority?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setLayout(layoutFor(r.width, r.height, mode));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  return (
    <div ref={ref} aria-hidden className={`overflow-hidden ${className}`} style={style}>
      <div
        className="absolute left-0 top-0 origin-top-left transition-opacity duration-500"
        style={{
          width: PHOTO_W,
          height: PHOTO_H,
          opacity: layout ? 1 : 0,
          transform: layout ? `translate(${layout.x}px, ${layout.y}px) scale(${layout.s})` : undefined,
          // In the wide hero the photo is shorter than the section: fade its sky into the gradient.
          ...(mode === "wide"
            ? {
                maskImage: "linear-gradient(to bottom, transparent 0%, black 30%)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 30%)",
              }
            : {}),
        }}
      >
        <Image
          src="/brand/hero-canal-laptop.webp"
          alt=""
          width={PHOTO_W}
          height={PHOTO_H}
          priority={priority}
          sizes="(min-width: 1024px) 100vw, 160vw"
          className="block h-full w-full select-none"
          draggable={false}
        />
        <div
          className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-[10px] bg-background"
          style={{ width: PREVIEW_W, height: PREVIEW_H, transform: SCREEN_MATRIX }}
        >
          <DashboardPreview />
        </div>
      </div>
    </div>
  );
}
