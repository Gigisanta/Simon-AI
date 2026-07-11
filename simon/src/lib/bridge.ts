/**
 * "Puente" — derivación asistida (warm handoff).
 *
 * Convierte la DETECCIÓN de Simón (los SafetyEvent, que ya se registran) en una
 * ACCIÓN concreta para el tutor/a: qué recurso contactar, qué decir y cómo
 * hablar con su hijo/a — con seguimiento (GuardianFollowup).
 *
 * PRIVACIDAD (M-P2, Ley 25.326): trabaja SOLO con metadata del SafetyEvent
 * (category + createdAt). NUNCA con el contenido del mensaje del menor. La
 * "sugerencia" se computa; nunca se persiste texto del menor.
 *
 * Núcleo PURO y testeable (scripts/bridge-suite.ts): resume la situación por
 * ventana y decide el estado de la tarjeta. La recomendación es ESTÁTICA (sin
 * LLM): no diagnostica, deriva a recursos reales y a la ayuda de una persona.
 */
import { PATTERN_CATEGORIES } from "@/lib/alerts";

/** Ventana de observación del Puente. */
export const BRIDGE_WINDOW_DAYS = 14;
export const BRIDGE_WINDOW_MS = BRIDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Umbral de repetición para las señales de patrón (riesgo/alimentario) en la
 * ventana. Más sensible que la alerta por email (anti-fatiga vive en el email;
 * el Puente es in-app, sin costo de spam): basta que se repita para ofrecer un
 * próximo paso.
 */
export const BRIDGE_PATTERN_THRESHOLD = 2;

export type BridgeReason = "crisis" | "abuso" | "riesgo" | "alimentario";

/** Metadata mínima de un SafetyEvent (JAMÁS contenido del menor). */
export type SafetyEventMeta = { category: string; createdAt: Date };

export type BridgeSituation = {
  reason: BridgeReason;
  severity: "alta" | "media";
  count: number;
  lastEventAt: Date;
};

/** ¿La categoría es una señal fuerte (crisis/abuso), no de patrón (riesgo/alimentario)? */
function isSevereCategory(category: string): boolean {
  return !(PATTERN_CATEGORIES as readonly string[]).includes(category);
}

/** Distingue abuso de crisis dentro de las señales fuertes (regex y moderación). */
function looksLikeAbuse(category: string): boolean {
  return /abus|sexual/i.test(category);
}

/**
 * Resume la situación del menor en la ventana, o null si no hay nada accionable.
 * Prioridad: señal fuerte (crisis/abuso, cualquier ocurrencia) por encima de la
 * repetición de patrón (riesgo/alimentario ≥ umbral). Puro.
 */
export function summarizeSituation(
  events: SafetyEventMeta[],
  now: Date,
): BridgeSituation | null {
  const cutoff = now.getTime() - BRIDGE_WINDOW_MS;
  const recent = events.filter((e) => e.createdAt.getTime() >= cutoff);
  if (recent.length === 0) return null;

  const severe = recent.filter((e) => isSevereCategory(e.category));
  if (severe.length > 0) {
    const reason: BridgeReason = severe.some((e) => looksLikeAbuse(e.category))
      ? "abuso"
      : "crisis";
    return {
      reason,
      severity: "alta",
      count: severe.length,
      lastEventAt: latest(severe),
    };
  }

  for (const cat of PATTERN_CATEGORIES) {
    const ofCat = recent.filter((e) => e.category === cat);
    if (ofCat.length >= BRIDGE_PATTERN_THRESHOLD) {
      return {
        reason: cat,
        severity: "media",
        count: ofCat.length,
        lastEventAt: latest(ofCat),
      };
    }
  }
  return null;
}

function latest(events: SafetyEventMeta[]): Date {
  return events.reduce(
    (max, e) => (e.createdAt.getTime() > max.getTime() ? e.createdAt : max),
    events[0]!.createdAt,
  );
}

/** Estado de seguimiento persistido (subconjunto de GuardianFollowup). */
export type FollowupState = {
  status: string; // "contacted" | "resolved" | "dismissed"
  updatedAt: Date;
} | null;

export type BridgeState = "none" | "suggestion" | "in_progress";

/**
 * Decide qué mostrar. Puro.
 * - Sin situación → "none".
 * - Followup dismissed/resolved cuyo updatedAt es POSTERIOR o igual al último
 *   evento → ya lo manejó: "none" (no molestar). Si hay eventos NUEVOS después,
 *   vuelve a "suggestion".
 * - Followup "contacted" al día con los eventos → "in_progress".
 * - En cualquier otro caso hay algo accionable → "suggestion".
 */
export function resolveBridgeState(
  situation: BridgeSituation | null,
  followup: FollowupState,
): BridgeState {
  if (!situation) return "none";
  if (followup) {
    const handledAfterLast =
      followup.updatedAt.getTime() >= situation.lastEventAt.getTime();
    if (
      handledAfterLast &&
      (followup.status === "dismissed" || followup.status === "resolved")
    ) {
      return "none";
    }
    if (handledAfterLast && followup.status === "contacted") {
      return "in_progress";
    }
  }
  return "suggestion";
}

/** Recomendación estática por motivo (SIN LLM). No diagnostica; deriva. */
export type BridgeRecommendation = {
  title: string;
  resourceLabel: string;
  script: string; // qué decir para pedir ayuda
  tip: string; // cómo acompañar a su hijo/a
};

const RECOMMENDATIONS: Record<BridgeReason, BridgeRecommendation> = {
  crisis: {
    title: "Simón detectó señales de angustia intensa",
    resourceLabel: "Ante peligro inmediato: 911 · Crisis: CAS 135 / 0800-345-1435 · Niñez: Línea 102",
    script:
      "Podés llamar a la Línea 102 y contar que tu hijo/a está pasando un momento muy difícil y que necesitás orientación. Si sentís que hay peligro ahora, 911.",
    tip: "Buscá un momento tranquilo, sin pantallas. Escuchá sin juzgar ni minimizar. A veces alcanza con estar cerca y decir 'estoy acá con vos'.",
  },
  abuso: {
    title: "Simón detectó señales de una posible situación de abuso o violencia",
    resourceLabel: "Línea 137 (violencia familiar y sexual, 24 hs) · Línea 102 (niñez)",
    script:
      "La Línea 137 atiende las 24 hs y es confidencial. Podés llamar vos para pedir orientación sobre cómo proteger a tu hijo/a y qué pasos seguir.",
    tip: "Creele y transmitile que no es su culpa. No lo/la hagas repetir el relato muchas veces. Priorizá su seguridad y buscá acompañamiento profesional.",
  },
  riesgo: {
    title: "Vienen repitiéndose momentos de angustia o malestar",
    resourceLabel: "Un/a profesional de salud mental de tu zona · Línea 102 · ver «Cerca tuyo»",
    script:
      "Podés pedir un turno con un/a psicólogo/a. Si te cuesta conseguir, la Línea 102 orienta sobre efectores cercanos según tu localidad.",
    tip: "Preguntale cómo está sin interrogarlo/a. Validá lo que siente en vez de resolverlo. Sostener el sueño, la rutina y los vínculos ayuda.",
  },
  alimentario: {
    title: "Aparecen preocupaciones repetidas con la comida o el cuerpo",
    resourceLabel: "Consulta con pediatra o salud mental · Línea 102 · ver «Cerca tuyo»",
    script:
      "Conviene una consulta con el/la pediatra o un/a profesional de salud mental para una evaluación temprana, sin dramatizar.",
    tip: "Evitá comentarios sobre el cuerpo, el peso o la comida. Enfocá en cómo se siente, no en lo que come. La detección temprana ayuda mucho.",
  },
};

export function recommendationFor(reason: BridgeReason): BridgeRecommendation {
  return RECOMMENDATIONS[reason];
}

/** Tarjeta expuesta al cliente (server → UI). Sin datos identificables del menor. */
export type BridgeCard = {
  childId: string;
  childName: string;
  state: Exclude<BridgeState, "none">;
  reason: BridgeReason;
  severity: "alta" | "media";
  count: number;
  lastEventAt: string; // ISO
  recommendation: BridgeRecommendation;
  followupStatus: string | null;
};

/**
 * Arma la tarjeta para un menor a partir de su situación + su followup. Puro.
 * Devuelve null si no hay nada que mostrar (estado "none").
 */
export function buildBridgeCard(
  child: { id: string; name: string },
  events: SafetyEventMeta[],
  followup: FollowupState,
  now: Date,
): BridgeCard | null {
  const situation = summarizeSituation(events, now);
  const state = resolveBridgeState(situation, followup);
  if (state === "none" || !situation) return null;
  return {
    childId: child.id,
    childName: child.name,
    state,
    reason: situation.reason,
    severity: situation.severity,
    count: situation.count,
    lastEventAt: situation.lastEventAt.toISOString(),
    recommendation: recommendationFor(situation.reason),
    followupStatus: followup?.status ?? null,
  };
}
