/**
 * Avatar de Simón (design system simon-mocha): arvejita verde sonriente sobre
 * círculo verde suave, con brote. Decorativo: siempre aria-hidden.
 */
export function SimonAvatar({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="16" cy="16" r="16" fill="#d9eede" />
      {/* brote */}
      <path
        d="M16 8.2c.2-2 1.5-3.4 3.4-3.7"
        stroke="#5a7f61"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M19.4 4.5c1.4-.3 2.6.2 3.2 1.2-1 .8-2.4.9-3.4.2z"
        fill="#679f69"
      />
      {/* cara */}
      <circle cx="16" cy="18" r="9" fill="#679f69" />
      <circle cx="12.8" cy="16.6" r="1.25" fill="#2f4632" />
      <circle cx="19.2" cy="16.6" r="1.25" fill="#2f4632" />
      <path
        d="M12.4 20.4c1 1.5 2.3 2.2 3.6 2.2s2.6-.7 3.6-2.2"
        stroke="#2f4632"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
