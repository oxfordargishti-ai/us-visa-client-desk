"use client";

// Premium motion & 3D effects. Everything animates only `transform` / `opacity` (GPU-friendly, no layout work),
// pointer tracking uses motion values (no React re-renders), and all of it switches off for "reduce motion".
import * as React from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { cn } from "./ui";

/**
 * 3D tilt: the card leans toward the pointer (or finger) with a soft moving glare, like a glossy physical card.
 */
export function Tilt3D({ children, className, max = 9, glare = true, lift = 1.015, mouseOnly = false }: { children: React.ReactNode; className?: string; max?: number; glare?: boolean; lift?: number; mouseOnly?: boolean }) {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const hovering = useMotionValue(0);
  const spring = { stiffness: 220, damping: 22, mass: 0.6 };
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), spring);
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), spring);
  const scale = useSpring(useTransform(hovering, [0, 1], [1, lift]), spring);
  const gx = useTransform(px, [0, 1], [0, 100]);
  const gy = useTransform(py, [0, 1], [0, 100]);
  const glareOpacity = useSpring(useTransform(hovering, [0, 1], [0, 0.55]), spring);
  const glareBg = useMotionTemplate`radial-gradient(520px circle at ${gx}% ${gy}%, rgba(255,255,255,0.35), transparent 45%)`;

  // Phones/tablets: no pointer tilt (keeps scrolling smooth and layers simple) — a gentle press-in instead.
  const [fine, setFine] = React.useState(false);
  React.useEffect(() => setFine(window.matchMedia("(hover: hover) and (pointer: fine)").matches), []);
  if (reduce) return <div className={className}>{children}</div>;
  if (!fine) return <motion.div whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className={cn("relative", className)}>{children}</motion.div>;
  const move = (e: React.PointerEvent) => {
    if (mouseOnly && e.pointerType !== "mouse") return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const leave = () => {
    px.set(0.5);
    py.set(0.5);
    hovering.set(0);
  };
  return (
    <div className={cn("relative isolate z-0 [perspective:1100px]", className)}>
      <motion.div
        ref={ref}
        onPointerMove={move}
        onPointerEnter={(e) => (!mouseOnly || e.pointerType === "mouse") && hovering.set(1)}
        onPointerLeave={leave}
        onPointerCancel={leave}
        style={{ rotateX: rx, rotateY: ry, scale, transformStyle: "preserve-3d" }}
        className="relative h-full will-change-transform"
      >
        {children}
        {glare && <motion.div aria-hidden style={{ background: glareBg, opacity: glareOpacity }} className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] mix-blend-soft-light [border-radius:inherit]" />}
      </motion.div>
    </div>
  );
}

/** Slow-moving blurred gold/navy light behind a section — the "expensive" ambient glow. */
export function Aurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_80%_75%_at_30%_30%,black_35%,transparent_80%)]", className)}>
      <div className="aurora-blob left-[-10%] top-[-30%] h-[26rem] w-[26rem] bg-[radial-gradient(circle,rgba(201,168,106,0.38),transparent_65%)] [animation-duration:18s]" />
      <div className="aurora-blob right-[-12%] top-[-10%] h-[22rem] w-[22rem] bg-[radial-gradient(circle,rgba(120,150,230,0.22),transparent_65%)] [animation-delay:-6s] [animation-duration:22s]" />
      <div className="aurora-blob bottom-[-40%] left-[30%] h-[24rem] w-[24rem] bg-[radial-gradient(circle,rgba(227,201,146,0.3),transparent_65%)] [animation-delay:-11s] [animation-duration:26s]" />
    </div>
  );
}

/**
 * A gold 3D coin with the logo: it floats, slowly turns, and shows its gold edge as it rotates.
 * Pure CSS 3D (stacked layers), so it costs almost nothing to draw.
 */
export function Seal3D({ src = "/brand/logo-320.png", size = 112, className }: { src?: string; size?: number; className?: string }) {
  const reduce = useReducedMotion();
  const edge = 10;
  return (
    <div className={cn("[perspective:900px]", className)} style={{ width: size, height: size }}>
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        animate={reduce ? undefined : { rotateY: [-24, 24, -24], y: [0, -6, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* gold edge: thin stacked rings give the coin real thickness */}
        {Array.from({ length: edge }, (_, i) => (
          <div key={i} className="absolute inset-0 rounded-[28%] bg-gradient-to-br from-gold3 via-gold to-gold2" style={{ transform: `translateZ(${-i}px)` }} />
        ))}
        <div className="absolute inset-0 overflow-hidden rounded-[28%] bg-white p-[6%] shadow-[0_24px_50px_-18px_rgba(0,0,0,0.55)] ring-2 ring-gold/70" style={{ transform: "translateZ(1px)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="h-full w-full rounded-[22%] object-contain" />
          <span className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        </div>
      </motion.div>
    </div>
  );
}

/** Tiny gold sparks that drift upward — used sparingly on hero areas. */
export function Sparks({ count = 14, className }: { count?: number; className?: string }) {
  const reduce = useReducedMotion();
  const dots = React.useMemo(() => Array.from({ length: count }, (_, i) => ({ left: (i * 37) % 100, delay: (i * 0.71) % 6, dur: 6 + ((i * 1.3) % 5), size: 2 + (i % 3) })), [count]);
  if (reduce) return null;
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {dots.map((d, i) => (
        <span key={i} className="spark absolute bottom-[-10px] rounded-full bg-gold2" style={{ left: `${d.left}%`, width: d.size, height: d.size, animationDelay: `${d.delay}s`, animationDuration: `${d.dur}s` }} />
      ))}
    </div>
  );
}
