"use client";

import { useEffect, useState } from "react";

export default function CallTimer({ className = "" }: { className?: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    const id = setInterval(() => setSeconds(Math.floor((performance.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <span className={`font-mono tabular-nums ${className}`} role="timer">
      {mm}:{ss}
    </span>
  );
}
