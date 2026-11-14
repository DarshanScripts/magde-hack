// Beyond Words: four speech shapes meeting in the middle.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="9.5 9.5 29 29" aria-hidden="true" className="shrink-0 fill-ink">
      <path d="M16.25 9.5A6.75 6.75 0 0 1 23 16.25V23H16.25A6.75 6.75 0 0 1 16.25 9.5Z" />
      <path d="M31.75 9.5A6.75 6.75 0 0 1 31.75 23H25V16.25A6.75 6.75 0 0 1 31.75 9.5Z" opacity=".55" />
      <path d="M25 25H31.75A6.75 6.75 0 1 1 25 31.75V25Z" />
      <path d="M16.25 25H23V31.75A6.75 6.75 0 1 1 16.25 25Z" opacity=".55" />
    </svg>
  );
}
