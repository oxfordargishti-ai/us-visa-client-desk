"use client";

import { motion } from "motion/react";

// A template re-mounts on every navigation: each page swings in with a short 3D lift (transform + opacity only).
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, rotateX: 7, scale: 0.985, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1] }}
      style={{ transformPerspective: 1400, transformOrigin: "50% 0%" }}
    >
      {children}
    </motion.div>
  );
}
