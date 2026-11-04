/**
 * The small icon set used across the UI: authored 16px line icons with one stroke weight,
 * drawn in currentColor so they follow the text they sit next to.
 */
const PATHS = {
  star: <path d="M8 2.2l1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.2l-3.53 1.85.7-3.93L2.3 6.35l3.95-.55z" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  back: <path d="M9.5 3.5L5 8l4.5 4.5M5.5 8H13" />,
  reset: (
    <>
      <path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4" />
      <path d="M3 2.6v2.6h2.6" />
    </>
  ),
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  minus: <path d="M3.5 8h9" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </>
  ),
  moon: <path d="M13 9.8A5.5 5.5 0 0 1 6.2 3a5.5 5.5 0 1 0 6.8 6.8z" />,
  chevron: <path d="M4 10l4-4 4 4" />,
  alert: (
    <>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.6v3M8 11.3v.2" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false, className = '' }: { name: IconName; filled?: boolean; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * SENTINEL's mark: a compass rose ring with cardinal ticks and a north pointer,
 * the way a chart prints its magnetic rose.
 */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 6.5l2 5.5h-4z" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}
