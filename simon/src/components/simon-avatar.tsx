/**
 * Avatar/logo de Simón (design system, SVG exacto de la referencia): squircle
 * verde con carita sonriente, brote y mejillas. Decorativo: siempre aria-hidden.
 */
export function SimonAvatar({ className = "size-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M32 10 C30 4 24 2 20 3 C22 7 26 10 30 10.5 Z" fill="var(--color-ill-leaf)" />
      <line
        x1="32"
        y1="10"
        x2="32"
        y2="14"
        stroke="var(--color-ill-leaf)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect x="8" y="13" width="48" height="46" rx="22" fill="var(--color-brand-ill)" />
      <circle cx="24" cy="34" r="3.2" fill="var(--color-white)" />
      <circle cx="40" cy="34" r="3.2" fill="var(--color-white)" />
      <path
        d="M25 44 Q32 50 39 44"
        stroke="var(--color-white)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="17.5" cy="41" r="3" fill="var(--color-blush)" opacity="0.75" />
      <circle cx="46.5" cy="41" r="3" fill="var(--color-blush)" opacity="0.75" />
    </svg>
  );
}
