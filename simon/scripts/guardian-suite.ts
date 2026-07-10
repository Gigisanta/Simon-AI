/**
 * Suite ejecutable de tutela + consentimiento (sin framework — se corre con tsx).
 *
 *   pnpm guardian-suite
 *
 * Testea SOLO lógica pura y determinística, sin tocar la DB ni better-auth:
 *   1. canChat() — gate de consentimiento del chat (M-P1, Ley 25.326).
 *   2. Validación zod del body de alta de un menor.
 *   3. Construcción del email sintético del menor.
 *
 * Camino crítico (datos de menores): un error acá deja a un menor chateando sin
 * consentimiento, o acepta un alta inválida. Se cubre cada rama explícitamente.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
import { createChecker } from "./suite-helpers";
import {
  blockedChatMessage,
  canChat,
  NO_GUARDIAN_CHAT_REPLY,
} from "../src/lib/consent";
import {
  authorizeChildSignup,
  buildCreateChildSchema,
  childEmail,
  CHILD_EMAIL_DOMAIN,
  consumeChildSignupAuthorization,
  isChildEmail,
  pendingChildSignupCount,
  usernameFromEmail,
} from "../src/lib/guardian";
import { originAllowed } from "../src/lib/env-check";
import {
  buildSystemPrompt,
  GUARDIAN_PERSONA_ADDENDUM,
} from "../src/lib/ai/system-prompt";
import { sessionLimitApplies } from "../src/lib/session-limit";

const { check, done } = createChecker("Guardian suite");

// ---------- 1. canChat ----------
{
  // Guardian (o cualquier no-menor) siempre puede.
  check(canChat("guardian", null).ok === true, "canChat: guardian sin vínculo → ok");
  check(canChat("guardian", { consentAt: null }).ok === true, "canChat: guardian ignora consentAt");
  check(canChat(undefined, null).ok === true, "canChat: rol indefinido → ok (no es menor)");

  // Menor sin fila Guardian → no.
  const r1 = canChat("child", null);
  check(r1.ok === false && r1.reason === "no-guardian", "canChat: child sin Guardian → no");

  // Menor con Guardian pero sin consentAt → no.
  const r2 = canChat("child", { consentAt: null });
  check(r2.ok === false && r2.reason === "no-consent", "canChat: child sin consentAt → no");

  // Menor con consentAt → ok.
  const r3 = canChat("child", { consentAt: new Date("2026-07-08T00:00:00Z") });
  check(r3.ok === true, "canChat: child con consentAt → ok");

  // Consentimiento REVOCADO (suspensión standalone): bloquea aunque haya consentAt.
  const r4 = canChat("child", {
    consentAt: new Date("2026-07-08T00:00:00Z"),
    consentRevokedAt: new Date("2026-07-09T00:00:00Z"),
  });
  check(
    r4.ok === false && r4.reason === "consent-revoked",
    "canChat: child con consentimiento revocado → bloqueado (consent-revoked)",
  );
  // Reanudado (consentRevokedAt null) junto a consentAt → vuelve a ok.
  const r5 = canChat("child", {
    consentAt: new Date("2026-07-08T00:00:00Z"),
    consentRevokedAt: null,
  });
  check(r5.ok === true, "canChat: child con consentRevokedAt null → ok (reanudado)");
  // consentRevokedAt ausente (undefined) es compatible hacia atrás → ok.
  check(
    canChat("child", { consentAt: new Date("2026-07-08T00:00:00Z"), consentRevokedAt: undefined }).ok === true,
    "canChat: consentRevokedAt undefined (compat) → ok",
  );
}

// ---------- 1b. blockedChatMessage: mensaje amable del gate del chat ----------
{
  // Menor huérfano (sin tutor/a vivo) → mensaje amable (no 403 crudo). Es el gate
  // que evita que un menor opere sin supervisión tras borrarse su tutor/a.
  check(
    blockedChatMessage("no-guardian") === NO_GUARDIAN_CHAT_REPLY,
    "blockedChatMessage: no-guardian → mensaje amable de huérfano",
  );
  // El mensaje mantiene el tono de acompañamiento (no punitivo) y deriva a un
  // adulto responsable.
  check(
    NO_GUARDIAN_CHAT_REPLY.length > 0 && /adulto|cuida|mamá|papá/i.test(NO_GUARDIAN_CHAT_REPLY),
    "blockedChatMessage: el texto de huérfano deriva a un adulto responsable",
  );
  // Otros motivos caen al 403 genérico (null): NO se filtra un texto por defecto.
  check(blockedChatMessage("no-consent") === null, "blockedChatMessage: no-consent → null (403 genérico)");
  check(blockedChatMessage("cualquier-otro") === null, "blockedChatMessage: motivo desconocido → null (fail-safe)");
}

// ---------- 2. Validación zod del alta ----------
{
  // Año fijo para determinismo: edad 4..19 → birthYear 2007..2022.
  const schema = buildCreateChildSchema(2026);
  const base = {
    name: "Sofía",
    username: "sofi_2015",
    birthYear: 2015,
    password: "unaClave8",
    consent: true as const,
  };

  check(schema.safeParse(base).success === true, "zod: alta válida pasa");

  // Username inválido.
  check(
    schema.safeParse({ ...base, username: "ab" }).success === false,
    "zod: username muy corto rechaza",
  );
  check(
    schema.safeParse({ ...base, username: "Sofi" }).success === false,
    "zod: username con mayúsculas rechaza",
  );
  check(
    schema.safeParse({ ...base, username: "sofi con espacio" }).success === false,
    "zod: username con espacios rechaza",
  );
  check(
    schema.safeParse({ ...base, username: "a".repeat(25) }).success === false,
    "zod: username muy largo rechaza",
  );

  // birthYear fuera de rango.
  check(
    schema.safeParse({ ...base, birthYear: 2006 }).success === false,
    "zod: birthYear demasiado viejo (>19) rechaza",
  );
  check(
    schema.safeParse({ ...base, birthYear: 2023 }).success === false,
    "zod: birthYear demasiado nuevo (<4) rechaza",
  );
  check(
    schema.safeParse({ ...base, birthYear: 2015.5 }).success === false,
    "zod: birthYear no entero rechaza",
  );
  // Bordes válidos.
  check(schema.safeParse({ ...base, birthYear: 2007 }).success === true, "zod: birthYear=2007 (19) ok");
  check(schema.safeParse({ ...base, birthYear: 2022 }).success === true, "zod: birthYear=2022 (4) ok");

  // Password corta / larga.
  check(
    schema.safeParse({ ...base, password: "corta7" }).success === false,
    "zod: password <8 rechaza",
  );
  check(
    schema.safeParse({ ...base, password: "a".repeat(73) }).success === false,
    "zod: password >72 rechaza",
  );

  // consent false / ausente.
  check(
    schema.safeParse({ ...base, consent: false }).success === false,
    "zod: consent=false rechaza",
  );
  check(
    schema.safeParse({ name: base.name, username: base.username, birthYear: base.birthYear, password: base.password }).success === false,
    "zod: consent ausente rechaza",
  );

  // name vacío / muy largo.
  check(schema.safeParse({ ...base, name: "" }).success === false, "zod: name vacío rechaza");
  check(
    schema.safeParse({ ...base, name: "a".repeat(61) }).success === false,
    "zod: name >60 rechaza",
  );

  // --- Bordes VÁLIDOS exactos (guardas off-by-one del límite inferior/superior) ---
  check(schema.safeParse({ ...base, username: "abc" }).success === true, "zod: username 3 chars (mín) ok");
  check(schema.safeParse({ ...base, username: "a".repeat(24) }).success === true, "zod: username 24 chars (máx) ok");
  check(schema.safeParse({ ...base, username: "ab_1" }).success === true, "zod: username con guion bajo y dígitos ok");
  check(schema.safeParse({ ...base, password: "a".repeat(8) }).success === true, "zod: password 8 (mín) ok");
  check(schema.safeParse({ ...base, password: "a".repeat(72) }).success === true, "zod: password 72 (máx) ok");
  check(schema.safeParse({ ...base, name: "a".repeat(60) }).success === true, "zod: name 60 (máx) ok");
  // name se recorta (trim): " Ana " es válido y queda "Ana".
  {
    const parsed = schema.safeParse({ ...base, name: "  Ana  " });
    check(parsed.success === true && parsed.data.name === "Ana", "zod: name se recorta (trim) a 'Ana'");
  }
  // birthYear apenas fuera de borde (guarda de off-by-one inferior/superior).
  check(schema.safeParse({ ...base, birthYear: 2006 }).success === false, "zod: birthYear=2006 (20) rechaza (borde)");
  check(schema.safeParse({ ...base, birthYear: 2023 }).success === false, "zod: birthYear=2023 (3) rechaza (borde)");
}

// ---------- 3. Email sintético ----------
{
  check(
    childEmail("sofi_2015") === `sofi_2015@${CHILD_EMAIL_DOMAIN}`,
    "email: childEmail construye el dominio .invalid",
  );
  check(CHILD_EMAIL_DOMAIN.endsWith(".invalid"), "email: dominio termina en .invalid (nunca ruteable)");
  check(
    usernameFromEmail(childEmail("juan_2016")) === "juan_2016",
    "email: usernameFromEmail invierte childEmail",
  );
  check(
    usernameFromEmail("guardian@gmail.com") === "guardian@gmail.com",
    "email: usernameFromEmail deja intacto un email no sintético",
  );
}

// ---------- 4. Guard de email sintético (C1) ----------
{
  check(isChildEmail(childEmail("sofi_2015")) === true, "isChildEmail: email sintético → true");
  check(isChildEmail("tutor@gmail.com") === false, "isChildEmail: email real → false");
  // Case-insensitive: un atacante no puede eludir el guard con mayúsculas.
  check(
    isChildEmail("x@NINOS.SIMON.INVALID") === true,
    "isChildEmail: dominio en mayúsculas también matchea (anti-bypass)",
  );
  check(
    isChildEmail("x@Ninos.Simon.Invalid") === true,
    "isChildEmail: mixed-case también matchea",
  );
}

// ---------- 5. Autorización interna de alta (C1, un solo uso + TTL) ----------
{
  const email = childEmail("caso_suite");
  const t0 = 1_000_000;

  // Sin autorizar → no pasa.
  check(
    consumeChildSignupAuthorization(email, t0) === false,
    "authz: sin autorizar → consume false",
  );

  // Autorizada y vigente → pasa UNA vez.
  authorizeChildSignup(email, t0);
  check(
    consumeChildSignupAuthorization(email, t0 + 1_000) === true,
    "authz: autorizada y vigente → consume true",
  );
  check(
    consumeChildSignupAuthorization(email, t0 + 1_000) === false,
    "authz: segunda consumición → false (un solo uso)",
  );

  // Vencida (TTL 30s) → no pasa, y la entrada se borra igual.
  authorizeChildSignup(email, t0);
  check(
    consumeChildSignupAuthorization(email, t0 + 31_000) === false,
    "authz: vencida (>30s) → consume false",
  );
  check(
    consumeChildSignupAuthorization(email, t0 + 31_000) === false,
    "authz: la entrada vencida no queda reutilizable",
  );

  // Case-insensitive: la autorización y el consumo normalizan el email.
  authorizeChildSignup(email.toUpperCase(), t0);
  check(
    consumeChildSignupAuthorization(email, t0 + 1_000) === true,
    "authz: autorización case-insensitive",
  );
}

// ---------- 5b. Barrido de entradas vencidas (anti fuga de memoria) ----------
{
  // Sin barrido, un alta autorizada que NUNCA se consume (p.ej. signUpEmail
  // lanza justo después de autorizar) dejaría la entrada colgada para siempre.
  // Se verifica que authorize y consume evictan oportunistamente lo vencido.
  const t0 = 5_000_000;
  const a = childEmail("sweep_a");
  const b = childEmail("sweep_b");
  const c = childEmail("sweep_c");

  const before = pendingChildSignupCount();
  authorizeChildSignup(a, t0); // expira t0+30000
  authorizeChildSignup(b, t0 + 10_000); // expira t0+40000
  check(
    pendingChildSignupCount() === before + 2,
    "sweep: dos altas autorizadas quedan pendientes",
  );

  // Autorizar c en t0+31000 (a ya venció): el propio authorize barre a `a`.
  authorizeChildSignup(c, t0 + 31_000); // expira t0+61000
  check(
    pendingChildSignupCount() === before + 2,
    "sweep: authorize evicta la entrada vencida y nunca consumida (a)",
  );

  // Consumir c en t0+41000 (b ya venció): el mismo consume barre `b`, sin
  // alterar la resolución de c (recién autorizada, sigue vigente).
  check(
    consumeChildSignupAuthorization(c, t0 + 41_000) === true,
    "sweep: c sigue consumible pese al barrido concurrente",
  );
  check(
    pendingChildSignupCount() === before,
    "sweep: consume evicta la vencida (b) y consume c → vuelve al baseline",
  );
}

// ---------- 6. Chequeo de origen (M3, originAllowed) ----------
{
  const base = { baseUrl: "https://simon.example.com", requestHost: "simon.example.com" };

  // Sin header Origin (curl, server-to-server) → permitir (SameSite=Lax defiende).
  check(originAllowed(null, base) === true, "origin: sin header → permitido");
  // Mismo origin exacto → permitir.
  check(
    originAllowed("https://simon.example.com", base) === true,
    "origin: mismo origin → permitido",
  );
  // Cross-site → 403.
  check(
    originAllowed("https://evil.example.com", base) === false,
    "origin: cross-site → rechazado",
  );
  // Mismo host pero otro scheme → rechazado (origin = scheme+host+puerto).
  check(
    originAllowed("http://simon.example.com", base) === false,
    "origin: mismo host con http → rechazado",
  );
  // Otro puerto → rechazado.
  check(
    originAllowed("https://simon.example.com:8443", base) === false,
    "origin: otro puerto → rechazado",
  );
  // Origin "null" (iframe sandboxed) → rechazado.
  check(originAllowed("null", base) === false, 'origin: "null" → rechazado');
  // Origin malformado → rechazado.
  check(originAllowed("no-es-una-url", base) === false, "origin: malformado → rechazado");
  // Dev (sin BETTER_AUTH_URL): se compara contra el Host del request.
  check(
    originAllowed("http://localhost:3000", { requestHost: "localhost:3000" }) === true,
    "origin: dev sin baseUrl, host coincide → permitido",
  );
  check(
    originAllowed("http://evil.com", { requestHost: "localhost:3000" }) === false,
    "origin: dev sin baseUrl, host distinto → rechazado",
  );
  // Sin baseUrl ni host contra qué comparar → rechazado (fail-closed).
  check(
    originAllowed("http://localhost:3000", {}) === false,
    "origin: sin referencia contra qué comparar → rechazado",
  );
}

// ---------- 7. Agente diferenciado por rol (B3) ----------
{
  // Marcador distintivo del addendum de tutor/a (sirve para detectar presencia).
  const marker = "AJUSTE DE INTERLOCUTOR";
  check(GUARDIAN_PERSONA_ADDENDUM.includes(marker), "rol: el addendum tiene su marcador");

  const guardianPrompt = buildSystemPrompt({ cards: [], memories: [], role: "guardian" });
  const childPrompt = buildSystemPrompt({ cards: [], memories: [], role: "child" });
  const defaultPrompt = buildSystemPrompt({ cards: [], memories: [] });

  check(guardianPrompt.includes(marker), "rol: persona guardian INCLUYE el addendum adulto");
  check(!childPrompt.includes(marker), "rol: persona child NO incluye el addendum");
  check(!defaultPrompt.includes(marker), "rol: sin rol (default) NO incluye el addendum");
  // La persona base (mismo comienzo) se preserva para ambos.
  check(childPrompt.startsWith("Sos Simón,"), "rol: child mantiene la persona base exacta");
  check(guardianPrompt.startsWith("Sos Simón,"), "rol: guardian mantiene la persona base");
  // Menciona los ejes de tutor/a (CUD, prestaciones).
  check(GUARDIAN_PERSONA_ADDENDUM.includes("CUD"), "rol: addendum menciona el CUD");

  // Límite de sesión (B3.2): solo aplica a menores.
  check(sessionLimitApplies("child") === true, "sesión: aplica a child");
  check(sessionLimitApplies("guardian") === false, "sesión: NO aplica a guardian");
  check(sessionLimitApplies(undefined) === false, "sesión: rol indefinido → no aplica");
  check(sessionLimitApplies(null) === false, "sesión: rol null → no aplica");
}

done();
