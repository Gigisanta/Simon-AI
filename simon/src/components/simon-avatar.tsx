/**
 * Avatar abstracto de Simón (research-ux §1.2 / §1.6 item 9): blob geométrico
 * suave, SIN rasgos faciales ni expresiones, para dar calidez sin
 * antropomorfizar. Decorativo: siempre aria-hidden.
 */
export function SimonAvatar({ className = "size-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={`shrink-0 text-teal-700 dark:text-teal-400 calm:text-stone-500 dark:calm:text-stone-400 ${className}`}
    >
      <path
        fill="currentColor"
        d="M16.4 3c5.9-.3 11 4.1 12 9.4 1 5.4-1.7 10.9-6.3 13.6-4.5 2.7-10.6 2.1-14.4-1.5C4 21 2.6 15.3 4.8 10.5 6.9 5.9 11.3 3.3 16.4 3z"
      />
      <path
        fill="currentColor"
        opacity="0.35"
        d="M20.5 8.2c2.4 1 4 3.3 4.2 5.8.1 1.3-1.9 1.5-2.3.3-.5-1.7-1.6-3.1-3.1-3.9-1.2-.6-.2-2.7 1.2-2.2z"
      />
    </svg>
  );
}
