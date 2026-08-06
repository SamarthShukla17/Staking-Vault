"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  /** Stagger delay (seconds) for this card's entrance animation. */
  delay?: number;
  className?: string;
}

/** Shared card shell: flat neutral surface, hairline border, quick fade-in-up entrance. */
export function Card({ children, delay = 0, className = "" }: CardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] p-5 sm:p-6 ${className}`}
    >
      {children}
    </motion.section>
  );
}
