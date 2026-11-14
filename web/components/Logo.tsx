import { useId } from "react";

// Beyond Words: a speech bubble that opens up, its voice wave carrying on past the edge.
export function Logo({ size = 40 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="6" y1="8" x2="44" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3d5afe" />
          <stop offset="1" stopColor="#1f9d63" />
        </linearGradient>
      </defs>
      <path
        d="M33 12.6A15 15 0 0 0 9 24.5c0 2.9.8 5.6 2.3 7.9L9.5 39l6.7-1.9A15 15 0 0 0 36.9 30"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill={`url(#${id})`}>
        <rect x="16" y="20.5" width="3.6" height="8" rx="1.8" />
        <rect x="22" y="16.5" width="3.6" height="16" rx="1.8" />
        <rect x="28" y="19" width="3.6" height="11" rx="1.8" />
        <rect x="34" y="16" width="3.6" height="17" rx="1.8" opacity=".75" />
        <rect x="40" y="20" width="3.6" height="9" rx="1.8" opacity=".45" />
      </g>
    </svg>
  );
}
