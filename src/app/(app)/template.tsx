"use client";

import { motion } from "motion/react";

// A template re-mounts on every navigation, which gives each page a smooth entrance.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14, filter: "blur(5px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}
