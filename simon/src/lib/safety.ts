/**
 * Capa de seguridad: detección de señales de crisis ANTES y DESPUÉS del LLM.
 *
 * Diseño: híbrido regex + (a futuro) clasificador. Un falso positivo en la
 * capa de "riesgo" solo antepone recursos de ayuda a la respuesta del LLM;
 * un falso negativo es mucho más costoso, así que las reglas son amplias.
 * OJO: crisis / abuso / alimentario PUENTEAN al LLM con una plantilla fija,
 * así que sus patrones se acotan para no secuestrar frases cotidianas obvias.
 *
 * Plantillas y recursos: ver docs/research-safety.md §3.3 (plantillas) y §3.4
 * (recursos verificados). Los números provienen de fuentes oficiales
 * argentinas y deben revisarse periódicamente.
 */

export type SafetyFlag = "crisis" | "abuso" | "alimentario" | "riesgo" | null;

const CRISIS_PATTERNS: RegExp[] = [
  // --- T1: ideación suicida explícita ---
  /suicid/i, // "suicidarme", "suicidio", "quiero suicidarme"
  /quitarme la vida/i,
  /\bmatarme\b/i,
  /\bme (quiero|quisiera|deseo|voy a) matar\b/i,
  /no quiero (vivir|seguir viviendo|existir)/i,
  // "quiero morir(me)" — excluye modismos ("morirme de risa/hambre/sueño...").
  /\b(quiero|quisiera|quiere|quieren) (morir(me|te|se)?|desaparecer|no despertar)\b(?!\s+de\s+(risa|hambre|sue[ñn]o|calor|fr[ií]o|amor|aburrimiento|verg[üu]enza|los? nervios))/i,
  /(matarse|morirse|suicidarse)/i,
  /(terminar|acabar) con (todo|mi vida)/i,

  // --- T2: ideación suicida indirecta ---
  /mejor sin m[ií]/i, // "todos estarían mejor sin mí"
  /ya no importa nada/i,
  /no voy a estar m[aá]s/i,
  /(qu[eé] pasa )?despu[eé]s de (la )?muerte/i,
  /qu[eé] pasa (cuando|si|despu[eé]s de) (me muero|muero|morir)/i,

  // --- T3: autolesión ---
  // Cortarse: excluye "me corto el pelo / las uñas / el flequillo / la barba".
  /\b(me|se) (corto|corta|cortan|cortás)\b(?!\s+(el|la|los|las)\s+(pelo|cabello|u[ñn]as?|flequillo|barba|c[eé]sped|pasto))/i,
  /\b(me|se) (lastimo|lastima|lastiman|hago da[ñn]o|hace da[ñn]o|quemo|quema)\b/i,
  /hacerme da[ñn]o/i,
  /autolesi/i,

  // --- T7: peligro inmediato ---
  /hay alguien (en|adentro de|dentro de) (mi|la) casa/i,
  /me (est[aá]n |vienen )?persigu(e|ie|iendo)/i,
];

const ABUSE_PATTERNS: RegExp[] = [
  // Golpes: plural casi siempre agresión; singular excluye el sentido "pegar
  // (adherir) algo" — "me pega los stickers / la figurita / el papel".
  /\bme pegan\b/i,
  /\bme pega\b(?!\s+(l[oa]s?\s+)?(sticker|figur|papel|calco|pegament|goma|afiche|cartel|foto|l[aá]mina))/i,
  /\bme (golpean?|maltratan?|lastiman? (en casa|mis? )?)/i,
  /abus(o|an|ó|aron|aba|aban) de m[ií]/i,
  // Tocamientos: sujeto (familiar/adulto) + "me toca", o con contexto explícito;
  // así se evita el "me toca" = "es mi turno" ("me toca limpiar").
  /(t[ií]o|t[ií]a|primo|prima|abuel[oa]|vecin[oa]|padrastro|madrastra|hermanastr[oa]|hermano|hermana|un adulto|un grande|un se[ñn]or|un hombre|una persona|alguien)\b.{0,20}\bme toca/i,
  /\bme toca\b\s*(sin permiso|donde no|mis partes|las partes|abajo|la cola|el cuerpo|el pito|la vagina|el pene)/i,
  /me tocan? (sin permiso|donde no)/i,
  /violencia en (mi )?casa/i,
  /tengo miedo de (mi|un) (pap[aá]|mam[aá]|familiar|vecino|t[ií]o|padrastro)/i,
];

const EATING_PATTERNS: RegExp[] = [
  // T5: trastornos alimentarios.
  /me hago (vomitar|v[oó]mito|v[oó]mitos)/i,
  /(me provoco|me fuerzo a|me obligo a) vomitar/i,
  /vomito (lo que|despu[eé]s de) com/i,
  // "no como nada" — excluye "no como nada de <comida/eso>".
  /\bno como (casi )?nada\b(?!\s+de\b)/i,
  /(dejé|deje|dejo) de comer/i,
  /me odio cuando como/i,
];

const RISK_PATTERNS: RegExp[] = [
  /no aguanto m[aá]s/i,
  /nadie me (quiere|escucha|entiende)/i,
  /estoy (solo|sola) en esto/i,
  /ataque de p[aá]nico/i,
  /no puedo m[aá]s/i,
];

export function detectSafetyFlag(text: string): SafetyFlag {
  if (CRISIS_PATTERNS.some((r) => r.test(text))) return "crisis";
  if (ABUSE_PATTERNS.some((r) => r.test(text))) return "abuso";
  if (EATING_PATTERNS.some((r) => r.test(text))) return "alimentario";
  if (RISK_PATTERNS.some((r) => r.test(text))) return "riesgo";
  return null;
}

/**
 * Recursos verificados (docs/research-safety.md §3.4). Se usan textualmente en
 * el addendum de "riesgo" (angustia) que sí pasa por el LLM. Las plantillas de
 * crisis/abuso/alimentario más abajo llevan su propia selección de recursos.
 *
 * Correcciones vs. versión previa: la Línea 102 NO es servicio de emergencia y
 * su horario varía por provincia; se agregó el CAS 0800-345-1435 (todo el país,
 * 8:00 a 0:00) y la Línea 137 (violencia familiar/sexual, 24 hs) con WhatsApp.
 */
export const CRISIS_RESOURCES_AR = `Recursos de ayuda en Argentina:
• Emergencias: 911 (las 24 hs)
• Centro de Asistencia al Suicida (CAS): 135 (CABA/GBA) · 0800-345-1435 (todo el país). Gratis y anónimo, de 8:00 a 0:00 hs.
• Línea 102: niñez y adolescencia (gratuita). El horario varía según la provincia; no es un servicio de emergencia.
• Línea 137: violencia familiar y sexual (24 hs, gratuita). WhatsApp: 11-3133-1000.
• Línea 144: violencia de género (24 hs, gratuita).
Si estás en peligro ahora mismo, llamá al 911 o acercate a la guardia médica más cercana.`;

/**
 * Plantilla CRITICAL — ideación suicida (T1), peligro inmediato (T7) y crisis
 * afines. Texto exacto de research-safety.md §3.3, sin variación del LLM.
 */
export const CRITICAL_TEMPLATE = `Lo que me estás contando es muy importante y quiero que estés seguro/a.
Por favor, contactá ahora mismo a alguien que te pueda ayudar:

🆘 Emergencias: 911
📞 Crisis emocional (Centro de Asistencia al Suicida): 135 (CABA/GBA) · 0800-345-1435 (todo el país)
   Atención 8:00 a 0:00 hs. Gratis y anónimo.
📞 Niñez y adolescencia: 102 (gratuito, todo el país)
📞 Violencia familiar/sexual: 137 (24 hs, gratuito)

Si sentís que estás en peligro ahora mismo, llamá al 911 o pedile ayuda a alguien cercano.
Yo soy una IA y no puedo ayudarte en este momento como lo haría una persona real.`;

/**
 * Plantilla ABUSE — revelación de abuso o violencia (T4). Texto exacto de
 * research-safety.md §3.3: incluye 102 + 137 + WhatsApp y el mensaje explícito
 * "no es tu culpa". Sin variación del LLM.
 */
export const ABUSE_TEMPLATE = `Gracias por contarme. Lo que me decís es muy serio y hay personas que pueden ayudarte.
Lo que te está pasando no está bien y no es tu culpa.

📞 Línea 102 (niñez y adolescencia): 102 — gratuita, confidencial, todo el país.
📞 Línea 137 (violencia familiar/sexual): 137 — 24 hs, gratuita.
   WhatsApp: 11-3133-1000

Podés llamar vos, o pedirle a alguien de confianza que llame por vos.
Yo soy una IA y no puedo protegerte, pero estas líneas sí pueden.`;

/**
 * Plantilla HIGH — usada para trastornos alimentarios (T5) y estilos afines:
 * primero reconoce/valida, después deriva a recursos (102 + CAS) y a un adulto
 * de confianza. Texto exacto de research-safety.md §3.3, sin variación del LLM.
 */
export const HIGH_TEMPLATE = `Gracias por contarme esto. Lo que sentís es válido, y me alegra que lo hayas compartido.
Quiero asegurarme de que tengas apoyo real:

📞 Si necesitás hablar con alguien ahora: Centro de Asistencia al Suicida · 135 (CABA/GBA) · 0800-345-1435
   Gratis · Anónimo · 8:00 a 0:00 hs.
📞 Para chicas, chicos y adolescentes: Línea 102 (gratuita, todo el país)

¿Hay un adulto de confianza — familiar, docente, profesional — con quien puedas hablar hoy?`;

/**
 * Respuesta fija (SIN LLM) para las señales que puentean al modelo.
 * - crisis      → CRITICAL_TEMPLATE
 * - abuso       → ABUSE_TEMPLATE (con Línea 137 y "no es tu culpa")
 * - alimentario → HIGH_TEMPLATE (acknowledge antes de derivar)
 */
export function crisisReply(flag: "crisis" | "abuso" | "alimentario"): string {
  if (flag === "abuso") return ABUSE_TEMPLATE;
  if (flag === "alimentario") return HIGH_TEMPLATE;
  return CRITICAL_TEMPLATE;
}

/**
 * Reemplazo seguro (SIN LLM) cuando la capa 2 marca la SALIDA generada por el
 * modelo como problemática. No mostramos el output del LLM; en su lugar
 * reconocemos que no podemos responder eso e invitamos a seguir charlando. Si
 * la categoría es crisis (self-harm), sumamos los recursos de ayuda.
 */
export function safeOutputReplacement(mappedFlag: SafetyFlag): string {
  const base =
    "Perdón, con eso no te puedo ayudar de la forma en que me gustaría. " +
    "Pero sigo acá con vos: ¿querés que sigamos charlando de lo que estabas sintiendo?";
  if (mappedFlag === "crisis") {
    return `${base}\n\nY si en algún momento la estás pasando muy mal, no estás solo/a:\n${CRISIS_RESOURCES_AR}`;
  }
  return base;
}

/**
 * Mensaje fijo cuando NINGUNA capa de moderación por API estuvo disponible
 * para validar la respuesta del modelo (A2). No mostramos el output crudo;
 * invitamos a reintentar y, si es urgente, a hablar con una persona adulta.
 */
export const MODERATION_UNAVAILABLE_MESSAGE =
  "Simón está teniendo un problema técnico, probá de nuevo en un rato. " +
  "Si te está pasando algo urgente o feo, no esperes: buscá a una persona " +
  "adulta de confianza y contale.";

export type UnmoderatedOutputDecision =
  | { action: "show" }
  | { action: "replace"; flag: Exclude<SafetyFlag, null>; reply: string }
  | { action: "block"; reply: string };

/**
 * POLÍTICA FAIL-CLOSED para la SALIDA del modelo cuando la Moderation API no
 * está disponible (A2). Función pura — testeada en scripts/moderation-suite.ts.
 *
 * 1. La regex (capa 1, detectSafetyFlag) es el PISO: si flaggea el output,
 *    NUNCA se muestra crudo → se sustituye por safeOutputReplacement(flag).
 * 2. Si la regex no flaggea, el output se muestra SOLO si la moderación de
 *    ENTRADA de este mismo request sí estuvo disponible (hubo al menos una
 *    capa de API activa validando el intercambio).
 * 3. Si AMBAS capas de API estuvieron caídas (entrada y salida) → no se
 *    muestra nada del modelo: mensaje seguro fijo (MODERATION_UNAVAILABLE_
 *    MESSAGE) e invitación a hablar con un adulto si es urgente.
 *
 * El caller registra SafetyEvent layer "moderation-unavailable" en los casos
 * "replace" y "block" (degradación observable en el panel).
 */
export function resolveUnmoderatedOutput(
  outputText: string,
  inputModerationAvailable: boolean,
): UnmoderatedOutputDecision {
  const flag = detectSafetyFlag(outputText);
  if (flag) {
    return { action: "replace", flag, reply: safeOutputReplacement(flag) };
  }
  if (inputModerationAvailable) return { action: "show" };
  return { action: "block", reply: MODERATION_UNAVAILABLE_MESSAGE };
}

/**
 * Derivación LIVIANA para el tier "riesgo" (angustia moderada, sin peligro
 * inmediato). No es el bloque de emergencia completo (CRISIS_RESOURCES_AR):
 * volcar 911 + línea del suicida + 137 + 144 ante una soledad o un agobio sin
 * riesgo inminente resultaba frío y alarmista (hallazgo del QA de consistencia).
 * Se mantiene una red real —adulto de confianza + Línea 102 (niñez y
 * adolescencia)— con tono cálido. Las señales fuertes (crisis/abuso) NO pasan
 * por acá: se resuelven con plantilla fija y su bloque completo de recursos.
 */
export const RIESGO_DERIVATION_AR =
  "Si querés hablar con alguien más, podés apoyarte en un adulto de confianza (un familiar, un/a docente) y también está la Línea 102, gratuita y pensada para chicas, chicos y adolescentes.";

/**
 * Instrucción extra que se antepone cuando se detecta angustia elevada
 * ("riesgo"): el modelo SÍ responde, priorizando CALIDEZ y una derivación
 * liviana, sin dar consejos clínicos. Crisis/abuso/alimentario no llegan acá
 * (se resuelven con plantilla fija); el camino no-"riesgo" queda como defensa
 * por si en el futuro se invoca con otra señal.
 */
export function crisisSystemAddendum(flag: Exclude<SafetyFlag, null>): string {
  if (flag === "riesgo") {
    return `ATENCIÓN: el último mensaje muestra angustia elevada (soledad, agobio, tristeza fuerte) SIN señales de peligro inmediato. En tu respuesta DEBÉS:
1. Ante todo, validar la emoción con calidez y cercanía: que se sienta escuchada/o, no evaluada/o. La contención va primero.
2. Recordar con suavidad que sos una IA y no un profesional, y que compartir esto con una persona adulta de confianza ayuda.
3. Ofrecer, de forma cálida y NADA alarmista, esta derivación liviana (NO enumeres teléfonos de emergencia ni líneas de crisis):
${RIESGO_DERIVATION_AR}
4. NO dar técnicas, diagnósticos ni promesas ("todo va a estar bien").
5. Mantener la respuesta corta, humana y centrada en la persona, no en los recursos.`;
  }
  // Camino defensivo (no usado en prod: estas señales van por plantilla fija):
  // señal fuerte → recursos de emergencia completos.
  const senal =
    flag === "crisis"
      ? "posible ideación suicida o autolesión"
      : flag === "abuso"
        ? "posible situación de abuso o violencia"
        : "posible trastorno alimentario";
  return `ATENCIÓN: el último mensaje contiene señales de ${senal}. En tu respuesta DEBÉS:
1. Validar la emoción con calidez, sin dramatizar ni minimizar.
2. Decir con claridad que no sos un profesional y que esto es importante hablarlo con una persona adulta de confianza y con profesionales.
3. Incluir estos recursos textualmente:
${CRISIS_RESOURCES_AR}
4. NO dar técnicas, diagnósticos ni promesas ("todo va a estar bien").
5. Mantener la respuesta corta y humana.`;
}

// ---------- Recordatorio periódico de IA (M-F3) ----------

/**
 * M-F3 (docs/research-safety.md §2.1): recordatorio consistente cada ~10
 * turnos de que Simón es una IA y no reemplaza ayuda profesional. Se anexa
 * DETERMINÍSTICAMENTE en route.ts (no depende de que el modelo se acuerde).
 */
export const DISCLOSURE_TEXT =
  "\n\nRecordá que soy una IA, no un profesional. Si sentís que necesitás más ayuda, podés hablar con un adulto de confianza o llamar a la Línea 102.";

/**
 * `assistantCount` son las respuestas del asistente YA guardadas en la
 * conversación: la que está por salir es la número assistantCount + 1, y el
 * recordatorio va en la 10ª, 20ª, 30ª... Función pura — testeada en
 * scripts/memory-suite.ts.
 */
export function shouldAppendDisclosure(assistantCount: number): boolean {
  return (assistantCount + 1) % 10 === 0;
}
