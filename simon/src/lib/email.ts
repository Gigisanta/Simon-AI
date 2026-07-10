/**
 * Envío de email transaccional (verificación del tutor/a + alerta de crisis).
 *
 * Si `RESEND_API_KEY` está seteada, usa el SDK de Resend. Si NO está, hace un
 * fallback de desarrollo explícito: loguea el contenido por consola para poder
 * probar localmente sin proveedor de email. El fallback NUNCA debe romper el
 * flujo que lo invoca.
 *
 * Errores reales de Resend se loguean y NO se propagan: ni el registro ni la
 * respuesta del chat deben fallar porque el proveedor de email tuvo un
 * problema. Ver docs/research-guardian.md §3.
 */
import { CRISIS_RESOURCES_AR } from "@/lib/safety";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "Simón <onboarding@resend.dev>";

/**
 * Transporte único: Resend si hay key; si no, log de desarrollo por consola.
 * Devuelve `true` si se envió (o se logueó en dev), `false` si el proveedor
 * falló. Nunca lanza.
 */
async function deliverEmail(
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  // --- Sin proveedor configurado ---
  if (!apiKey) {
    // M1: el cuerpo puede contener URLs con tokens (verificación de email).
    // En producción NUNCA se loguean: los logs de la plataforma no son un
    // lugar seguro para credenciales. Solo se deja constancia del fallo y el
    // flujo sigue (nunca rompe al caller).
    if (process.env.NODE_ENV === "production") {
      console.error("[email] RESEND_API_KEY no configurada — email no enviado");
      return false;
    }
    // Fallback SOLO de desarrollo: loguea el contenido para probar local.
    console.log(
      `[email:dev] Para: ${to} (configurá RESEND_API_KEY para enviar de verdad)\n  Asunto: ${subject}\n${text.replace(/^/gm, "  ")}`,
    );
    return true;
  }

  try {
    // Import dinámico: así el fallback de dev no obliga a resolver el SDK.
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      text,
    });
    if (error) {
      console.error("[email] Resend devolvió un error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Error inesperado enviando con Resend:", err);
    return false;
  }
}

/**
 * Entrega el email de verificación. Devuelve `true` si se envió (o se logueó en
 * dev), `false` si el proveedor falló.
 */
export async function deliverVerificationEmail(
  to: string,
  url: string,
): Promise<boolean> {
  return deliverEmail(
    to,
    "Confirmá tu email — Simón",
    "Hola,\n\n" +
      "Para empezar a usar Simón, confirmá tu email haciendo clic en este enlace:\n" +
      `${url}\n\n` +
      "Si no creaste esta cuenta, ignorá este mensaje.\n\n" +
      "— Simón",
  );
}

/**
 * Entrega el email de reseteo de contraseña del tutor/a. Mismo transporte
 * no-bloqueante que la verificación: en producción SIN RESEND_API_KEY el cuerpo
 * (que contiene la URL con el token de reseteo) NUNCA se loguea (gate NODE_ENV en
 * deliverEmail). Devuelve `true` si se envió (o se logueó en dev), `false` si el
 * proveedor falló. Nunca lanza.
 */
export async function deliverResetPasswordEmail(
  to: string,
  url: string,
): Promise<boolean> {
  return deliverEmail(
    to,
    "Restablecé tu contraseña — Simón",
    "Hola,\n\n" +
      "Recibimos un pedido para restablecer la contraseña de tu cuenta de Simón. " +
      "Para elegir una nueva, entrá en este enlace:\n" +
      `${url}\n\n` +
      "Si no lo pediste, ignorá este mensaje: tu contraseña actual sigue funcionando.\n\n" +
      "— Simón",
  );
}

/**
 * Alerta de crisis al tutor/a (M-P2). PRIVACIDAD DEL MENOR: se comparte la
 * señal detectada (`signal`, en lenguaje humano — ver humanCategory en
 * lib/alerts.ts), NUNCA el contenido de la conversación. Recursos verificados:
 * los mismos de lib/safety.ts (fuente única, no se duplican acá).
 */
export async function deliverCrisisAlert(
  to: string,
  { childName, signal }: { childName: string; signal: string },
): Promise<boolean> {
  return deliverEmail(
    to,
    "Simón: tu hijo/a puede necesitar tu apoyo",
    "Hola,\n\n" +
      `Te escribimos desde Simón. En una conversación reciente de ${childName} ` +
      `detectamos señales de ${signal}.\n\n` +
      "Por respeto a su privacidad no incluimos el contenido de la conversación: " +
      "te contamos el tema, no lo que dijo.\n\n" +
      "Te recomendamos buscar un momento tranquilo para hablar con él/ella hoy, " +
      "sin juzgar y sin retarlo/a por lo que contó. Escuchar es lo más importante.\n\n" +
      "Si la situación lo amerita, estos recursos pueden ayudar:\n\n" +
      `${CRISIS_RESOURCES_AR}\n\n` +
      "Recordá que Simón es una inteligencia artificial: acompaña, pero no " +
      "reemplaza tu mirada ni la de un profesional.\n\n" +
      "— Simón",
  );
}

/**
 * Alerta de PATRÓN al tutor/a (M-P2, acumulación de señales de menor severidad).
 * No es una crisis puntual: es una señal que se viene REPITIENDO. Tono más suave
 * que la alerta de crisis, deliberadamente no alarmista. PRIVACIDAD DEL MENOR:
 * se comparte el tema (`signal`, ver humanPatternCategory en lib/alerts.ts),
 * NUNCA el contenido de la conversación. Recursos: fuente única de lib/safety.ts.
 */
export async function deliverPatternAlert(
  to: string,
  { childName, signal }: { childName: string; signal: string },
): Promise<boolean> {
  return deliverEmail(
    to,
    "Simón: algo que quizás quieras acompañar",
    "Hola,\n\n" +
      `Te escribimos desde Simón. No es una urgencia, pero queríamos contarte ` +
      `algo con calma: en varias conversaciones recientes de ${childName} ` +
      `aparecieron ${signal}.\n\n` +
      "No es un episodio puntual sino algo que se repitió, y por eso preferimos " +
      "avisarte. Por respeto a su privacidad no incluimos lo que dijo: te " +
      "contamos el tema, no el contenido.\n\n" +
      "Puede ser un buen momento para buscar un rato tranquilo y preguntarle " +
      "cómo anda, sin presionar ni sacar conclusiones. Muchas veces alcanza con " +
      "estar disponible y escuchar.\n\n" +
      "Si te parece que la situación lo amerita, estos recursos pueden ayudar:\n\n" +
      `${CRISIS_RESOURCES_AR}\n\n` +
      "Recordá que Simón es una inteligencia artificial: acompaña, pero no " +
      "reemplaza tu mirada ni la de un profesional.\n\n" +
      "— Simón",
  );
}
