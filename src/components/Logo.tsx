/**
 * The DZL mark, kept in sync with `assets/logo.svg`, the source the app icons
 * are generated from. Edit both together if the mark changes.
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="DZL"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="dzl-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e85b5b" />
          <stop offset="1" stopColor="#b83c3c" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="114" fill="url(#dzl-tile)" />
      <rect
        x="22"
        y="22"
        width="468"
        height="468"
        rx="94"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.14"
        strokeWidth="4"
      />
      <path
        fill="#ffffff"
        d="M112 128 H400 V200 L252 312 H400 V384 H112 V312 L260 200 H112 Z"
      />
    </svg>
  );
}
