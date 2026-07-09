/**
 * Chips de check-in emocional (research-ux §1.3 / §1.6 items 1+6): entrada
 * guiada de baja fricción para literacidad baja o dificultad motora.
 * Iconos pictográficos geométricos (no emoji como único portador semántico)
 * en círculos pastel (design system simon-mocha). Touch target ≥ 44px.
 */

type Mood = {
  label: string;
  message: string;
  circle: string; // color pastel del círculo del icono
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
  className: "size-4 shrink-0",
} as const;

const MOODS: Mood[] = [
  {
    label: "Contento/a",
    message: "Me siento contento/a",
    circle: "bg-peach text-accent-deep",
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
    circle: "bg-sky text-sky-strong",
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
    circle: "bg-sand text-ink-soft",
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
    circle: "bg-peach text-danger",
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
    circle: "bg-brand-soft text-brand-strong",
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
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white py-1 pl-1.5 pr-4 text-base font-semibold text-ink shadow-sm transition-[color,border-color,transform,box-shadow] motion-safe:hover:-translate-y-0.5 hover:border-brand hover:text-brand-strong hover:shadow-md"
        >
          <span
            className={`flex size-8 items-center justify-center rounded-full ${mood.circle}`}
          >
            {mood.icon}
          </span>
          {mood.label}
        </button>
      ))}
    </div>
  );
}
