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
import { Prisma } from "@/generated/prisma/client";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  authorizeChildSignup,
  childEmail,
  createChildSchema,
  usernameFromEmail,
} from "@/lib/guardian";
import { requireGuardian } from "@/lib/guardian-auth";
import { sameOriginOk } from "@/lib/env-check";
import { z } from "zod";

// Alta de menores: acotado por tutor/a (evita scripting de creación masiva).
const CREATE_RATE_LIMIT_PER_MINUTE = 10;

/** IP del cliente: primer valor de x-forwarded-for, o x-real-ip. */
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  return real ? real.trim() : null;
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
      { error: "Demasiadas altas seguidas. Esperá un momento." },
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
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return Response.json(
      { error: "Ese nombre de usuario ya está en uso. Probá con otro." },
      { status: 409 },
    );
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
    return Response.json(
      { error: "No se pudo crear la cuenta del menor. Probá de nuevo." },
      { status: 400 },
    );
  }

  // Traer la fila canónica desde la DB (la protección de enumeración puede
  // devolver un id ficticio en la respuesta de signUpEmail).
  const child = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  if (!child) {
    return Response.json(
      { error: "No se pudo crear la cuenta del menor. Probá de nuevo." },
      { status: 500 },
    );
  }
  // Carrera: si ya era un menor existente (pre-check no lo vio), no lo pisamos.
  if (child.role === "child") {
    return Response.json(
      { error: "Ese nombre de usuario ya está en uso. Probá con otro." },
      { status: 409 },
    );
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
    // tenía tutor/a → mismo 409 que un username en uso.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return Response.json(
        { error: "Ese nombre de usuario ya está en uso. Probá con otro." },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "No se pudo crear la cuenta del menor. Probá de nuevo." },
      { status: 500 },
    );
  }

  return Response.json(
    { ok: true, child: { id: child.id, name, username, birthYear } },
    { status: 201 },
  );
}

export async function GET(req: Request) {
  const guard = await requireGuardian(req);
  if (!guard.ok) return guard.response;

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

  return Response.json({ children });
}
