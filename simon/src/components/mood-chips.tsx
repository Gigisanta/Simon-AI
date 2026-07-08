/**
 * Chips de check-in emocional (research-ux §1.3 / §1.6 items 1+6): entrada
 * guiada de baja fricción para literacidad baja o dificultad motora.
 * Iconos pictográficos geométricos (no emoji como único portador semántico).
 * Touch target ≥ 44px (WCAG 2.5.5).
 */

type Mood = {
  label: string;
  message: string;
  icon: React.ReactNode;
};

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "size-5 shrink-0",
} as const;

const MOODS: Mood[] = [
  {
    label: "Contento/a",
    message: "Me siento contento/a",
    // Sol: círculo con rayos
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      </svg>
    ),
  },
  {
    label: "Triste",
    message: "Me siento triste",
    // Gota
    icon: (
      <svg {...iconProps}>
        <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
      </svg>
    ),
  },
  {
    label: "Nervioso/a",
    message: "Me siento nervioso/a",
    // Ondas
    icon: (
      <svg {...iconProps}>
        <path d="M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
        <path d="M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      </svg>
    ),
  },
  {
    label: "Enojado/a",
    message: "Me siento enojado/a",
    // Rayo
    icon: (
      <svg {...iconProps}>
        <path d="M13 2 6 14h5l-2 8 7-12h-5l2-8z" />
      </svg>
    ),
  },
  {
    label: "No sé",
    message: "No sé cómo me siento",
    // Signo de pregunta en círculo
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.8.3-.9 1-.9 1.7" />
        <path d="M12 17h.01" />
      </svg>
    ),
  },
];

export function MoodChips({ onPick }: { onPick: (message: string) => void }) {
  return (
    <div
      role="group"
      aria-label="¿Cómo te sentís hoy?"
      className="flex flex-wrap justify-center gap-2"
    >
      {MOODS.map((mood) => (
        <button
          key={mood.label}
          type="button"
          aria-label={`Decirle a Simón: ${mood.message}`}
          onClick={() => onPick(mood.message)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-300 bg-white px-4 text-base text-stone-800 transition-colors hover:border-teal-700 hover:text-teal-800 calm:hover:border-stone-500 calm:hover:text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-teal-400 dark:hover:text-teal-300 dark:calm:hover:border-stone-500 dark:calm:hover:text-stone-200"
        >
          {mood.icon}
          {mood.label}
        </button>
      ))}
    </div>
  );
}
