"use client";

import { useEffect, useRef } from "react";
import { audioContext } from "@/lib/call";

const WEIGHTS = [0.55, 0.85, 1, 0.75, 0.5];

// Live equalizer for an audio track. Bars are driven through refs, not React state.
export default function LevelBars({
  track,
  className = "",
}: {
  track: MediaStreamTrack | null;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const bars = Array.from(root.current?.children ?? []) as HTMLElement[];
    const paint = (level: number, t: number) =>
      bars.forEach((bar, i) => {
        const wobble = 0.75 + 0.25 * Math.sin(t / 90 + i * 1.7);
        bar.style.transform = `scaleY(${Math.max(0.16, Math.min(1, level * WEIGHTS[i] * wobble))})`;
      });
    paint(0, 0);
    if (!track) return;

    const ac = audioContext();
    const source = ac.createMediaStreamSource(new MediaStream([track]));
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    let level = 0;
    let frame = 0;
    const tick = (t: number) => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const target = Math.min(1, Math.sqrt(sum / samples.length) * 9);
      level += (target - level) * (target > level ? 0.5 : 0.12);
      paint(level, t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
    };
  }, [track]);

  return (
    <span ref={root} className={`inline-flex h-5 items-center gap-[3px] ${className}`} aria-hidden="true">
      {WEIGHTS.map((_, i) => (
        <span key={i} className="h-full w-[3px] origin-center rounded-full bg-current" />
      ))}
    </span>
  );
}
