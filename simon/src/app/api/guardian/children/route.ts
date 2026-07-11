/**
 * Gestión de menores por parte del tutor/a (modelo tutor-first, Ley 25.326).
 *
 * POST  → da de alta un menor + registra el consentimiento verificable.
 * GET   → lista los menores del tutor/a autenticado.
 *
 * CAMINO CRÍTICO (auth + datos de menores): sesión de guardian requerida y con
 * email verificado; validación completa del body con zod; consentimiento
 * timestamped + IP + user-agent como evidencia. El menor se crea vía la API
 * server de better-auth (password hasheada) y se marca `emailVerified` para que
 * su email sintético `.invalid` no bloquee el login.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitMessage } from "@/lib/ui-messages";
import {
  authorizeChildSignup,
  childEmail,
  createChildSchema,
  usernameFromEmail,
} from "@/lib/guardian";
import { requireGuardian } from "@/lib/guardian-auth";
import {
  childSignupResponse,
  classifyChildTxError,
  type ChildSignupOutcome,
} from "@/lib/guardian-children";
import { sameOriginOk } from "@/lib/env-check";
import { z } from "zod";

/** Mapea un desenlace terminal del alta a su Response (fuente única del status/mensaje). */
function childSignupError(outcome: Exclude<ChildSignupOutcome, "ok">): Response {
  const { status, error } = childSignupResponse(outcome);
  return Response.json({ error }, { status });
}

// Alta de menores: acotado por tutor/a (evita scripting de creación masiva).
const CREATE_RATE_LIMIT_PER_MINUTE = 10;
// Listado (lectura): tope holgado por tutor/a, igual que las otras rutas de lectura.
const LIST_RATE_LIMIT_PER_MINUTE = 60;

/** IP del cliente (evidencia de consentimiento, F5). */
function clientIp(req: Request): string | null {
  // x-real-ip lo setea Vercel (no spoofeable por el cliente); x-forwarded-for
  // puede traer valores inyectados antes del proxy, así que es solo fallback.
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

export async function POST(req: Request) {
  // Defensa CSRF en profundidad (M3): si el navegador manda Origin y no es el
  // nuestro, se corta acá (la cookie SameSite=Lax es la defensa principal).
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const guard = await requireGuardian(req);
  if (!guard.ok) return guard.response;
  const guardianUser = guard.user;

  // Rate limit por tutor/a.
  const rl = await checkRateLimit(
    `guardian:children:${guardianUser.id}`,
    CREATE_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: rateLimitMessage("altas", "f") },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  // Validación del body (nunca confiar en el cliente).
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = createChildSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Datos inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { name, username, birthYear, password } = parsed.data;
  const email = childEmail(username);

  // Username duplicado → 409. (signUpEmail oculta duplicados por protección de
  // enumeración cuando requireEmailVerification está activo, así que chequeamos
  // acá explícitamente para dar un mensaje claro.)
  //
  // ENUMERACIÓN (SEC, residual aceptado): este 409 revela que un username de
  // menor ya existe. Es un chequeo de DISPONIBILIDAD de usuario, imprescindible
  // para el onboarding (el tutor/a necesita saber que debe elegir otro); no se
  // puede "normalizar" sin romper esa UX. El leak es mínimo (solo existencia de
  // un handle de login, sin nombre ni dueño) y está acotado: endpoint
  // autenticado como guardian (requireGuardian), rate-limit por tutor/a
  // (CREATE_RATE_LIMIT_PER_MINUTE) y body que debe pasar zod completo. El login
  // y el signup público NO son oráculos: better-auth normaliza sus errores.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return childSignupError("duplicate-precheck");
  }

  // Crear el menor vía better-auth: hashea la contraseña y crea User + Account.
  // C1: los emails sintéticos de menores están BLOQUEADOS en el signup público
  // (hook databaseHooks.user.create.before en lib/auth.ts). Esta autorización
  // in-process, de un solo uso y con TTL corto, es lo único que habilita el
  // alta — y solo puede emitirla este flujo server-side del tutor/a.
  //
  // ORDEN ELEGIDO (M2): `signUpEmail` NO puede entrar en la transacción de más
  // abajo — es una llamada in-process de better-auth con su propia lógica
  // (hash de password, creación de User + Account, hooks) y no acepta un
  // `PrismaClient` transaccional. Por eso el signup va PRIMERO y, si la
  // transacción posterior (promoción + consentimiento) falla, se limpia el user
  // recién creado (ver catch de la transacción) para no dejar el username
  // sintético bloqueado.
  try {
    authorizeChildSignup(email);
    await auth.api.signUpEmail({ body: { name, email, password } });
  } catch (err) {
    console.error("[guardian] error creando menor (signUpEmail):", err);
    return childSignupError("signup-failed");
  }

  // Traer la fila canónica desde la DB (la protección de enumeración puede
  // devolver un id ficticio en la respuesta de signUpEmail).
  const child = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  if (!child) {
    return childSignupError("no-canonical-user");
  }
  // Carrera: si ya era un menor existente (pre-check no lo vio), no lo pisamos.
  if (child.role === "child") {
    return childSignupError("race-already-child");
  }

  // Promoción a menor + registro del consentimiento en UNA transacción atómica
  // (M2): o quedan ambos, o ninguno. Nunca un menor promovido sin su registro de
  // consentimiento (Ley 25.326), ni un consentimiento apuntando a un user sin
  // promover.
  try {
    await prisma.$transaction([
      // role="child", birthYear y emailVerified (su email sintético nunca es
      // verificable, pero no debe bloquear su login).
      prisma.user.update({
        where: { id: child.id },
        data: { role: "child", birthYear, emailVerified: true },
      }),
      // Consentimiento verificable: timestamp + IP + user-agent.
      prisma.guardian.create({
        data: {
          guardianUserId: guardianUser.id,
          childUserId: child.id,
          consentAt: new Date(),
          consentIp: clientIp(req),
          consentUserAgent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
        },
      }),
    ]);
  } catch (err) {
    console.error("[guardian] error en el alta del menor (transacción):", err);
    // La transacción es atómica: al fallar, `child` quedó como un user recién
    // creado, SIN promover y SIN vínculo — un huérfano que bloquearía su email
    // sintético. Se borra best-effort (es fresco, sin conversaciones/datos, así
    // que no arrastra nada) para liberar el username. Nunca tumba la respuesta.
    await prisma.user
      .delete({ where: { id: child.id } })
      .catch((cleanupErr) =>
        console.error("[guardian] no se pudo limpiar el user huérfano:", cleanupErr),
      );
    // P2002 (unique de Guardian.childUserId): carrera en la que el menor ya
    // tenía tutor/a → mismo 409 que un username en uso. Cualquier otro → 500.
    // La clasificación del error vive en lib/guardian-children.ts (testeada).
    return childSignupError(classifyChildTxError(err));
  }

  return Response.json(
    { ok: true, child: { id: child.id, name, username, birthYear } },
    { status: 201 },
  );
}

export async function GET(req: Request) {
  const guard = await requireGuardian(req);
  if (!guard.ok) return guard.response;

  // Rate limit por tutor/a (lectura). Mismo shape 429 que las demás rutas.
  const rl = await checkRateLimit(
    `guardian:children:read:${guard.user.id}`,
    LIST_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: rateLimitMessage("consultas", "f") },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  const rows = await prisma.guardian.findMany({
    where: { guardianUserId: guard.user.id },
    select: {
      consentAt: true,
      alertsEnabled: true,
      childUser: { select: { id: true, name: true, email: true, birthYear: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const children = rows.map((r) => ({
    id: r.childUser.id,
    name: r.childUser.name,
    username: usernameFromEmail(r.childUser.email),
    birthYear: r.childUser.birthYear,
    consentAt: r.consentAt,
    alertsEnabled: r.alertsEnabled,
  }));

  // Lista de menores con PII: nunca cachear en proxies/navegador.
  return Response.json({ children }, { headers: { "cache-control": "no-store" } });
}
