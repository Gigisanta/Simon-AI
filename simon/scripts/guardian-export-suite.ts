/**
 * Suite del export de datos del menor (GET
 * /api/guardian/children/[childId]/export). Sin framework — tsx.
 *
 *   pnpm test guardian-export
 *
 * CAMINO CRÍTICO (datos personales de un menor). Cubre las piezas puras extraídas
 * en src/lib/export-child.ts + la authz/rate-limit reales de la ruta:
 *
 *   (1) 404 si el childId no pertenece al tutor/a: findOwnedChild con
 *       EXPORT_CHILD_SELECT devuelve null (no-dueño / rol != child / inexistente)
 *       → la ruta responde 404 (no revela cuentas ajenas). El caso dueño+menor sí
 *       devuelve el vínculo con el perfil proyectado.
 *   (2) Rate-limit real de la ruta: la clave `guardian:child-export:<id>` corta a
 *       las 5/min → la 6ª es 429 con retry-after dentro de la ventana.
 *   (3) El payload NUNCA incluye password/hash ni el email sintético crudo:
 *       EXPORT_CHILD_SELECT no proyecta password; buildChildProfile publica el
 *       "usuario" derivado (no el email) y no filtra credenciales.
 *   (4) Sanitización del nombre de archivo (`safeUser`): solo [a-z0-9_-]; cualquier
 *       otro carácter → `_`, para no romper/inyectar el header Content-Disposition.
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
// Sin credenciales de Upstash: checkRateLimit usa la implementación in-memory.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import { createChecker } from "./suite-helpers";
import {
  findOwnedChild,
  type GuardianOwnershipClient,
} from "../src/lib/guardian-auth";
import { checkRateLimit } from "../src/lib/rate-limit";
import { childEmail } from "../src/lib/guardian";
import {
  EXPORT_CHILD_SELECT,
  buildChildProfile,
  sanitizeExportUser,
  exportFilename,
  type ExportChildInput,
} from "../src/lib/export-child";

const { check, done } = createChecker("Guardian-export suite");

const MINUTE = 60_000;
// Tope real del handler de export (RATE_LIMIT_PER_MINUTE en la ruta).
const EXPORT_LIMIT = 5;

// ---------- Fake de prisma.guardian que emula el filtrado real de Postgres ----------
// (mismo patrón que guardian-auth-suite: los TRES constraints del where deben
// matchear, o el helper abriría un IDOR).
type FakeUser = {
  id: string;
  role: string;
  name: string;
  email: string;
  birthYear: number | null;
  createdAt: Date;
};
type FakeLink = {
  guardianUserId: string;
  childUserId: string;
  consentAt: Date | null;
  childUser: FakeUser;
};

const CHILD_EMAIL = childEmail("sofi_2015");
const link: FakeLink = {
  guardianUserId: "g1",
  childUserId: "c1",
  consentAt: new Date("2026-07-08T00:00:00Z"),
  childUser: {
    id: "c1",
    role: "child",
    name: "Sofía",
    email: CHILD_EMAIL,
    birthYear: 2015,
    createdAt: new Date("2026-07-08T00:00:00Z"),
  },
};

// Proyecta según EXPORT_CHILD_SELECT (consentAt + childUser básico).
function projectExport(l: FakeLink): Record<string, unknown> {
  return {
    consentAt: l.consentAt,
    childUser: {
      name: l.childUser.name,
      email: l.childUser.email,
      birthYear: l.childUser.birthYear,
      role: l.childUser.role,
      createdAt: l.childUser.createdAt,
    },
  };
}

const db: GuardianOwnershipClient = {
  guardian: {
    async findFirst(args) {
      const w = args.where;
      return w.guardianUserId === link.guardianUserId &&
        w.childUserId === link.childUserId &&
        w.childUser.role === link.childUser.role
        ? projectExport(link)
        : null;
    },
  },
};

async function testAuthz404() {
  // Dueño + menor → vínculo con perfil proyectado.
  const owned = await findOwnedChild("g1", "c1", EXPORT_CHILD_SELECT, db);
  check(owned !== null, "authz: dueño + menor → vínculo (200)");

  // No-dueño → null → la ruta responde 404 (no revela la cuenta ajena).
  const notOwner = await findOwnedChild("g2", "c1", EXPORT_CHILD_SELECT, db);
  check(notOwner === null, "authz: childId de otro tutor/a → null (ruta → 404)");

  // childId inexistente → null → 404.
  const missing = await findOwnedChild("g1", "no_existe", EXPORT_CHILD_SELECT, db);
  check(missing === null, "authz: childId inexistente → null (ruta → 404)");
}

async function testRateLimit() {
  const key = `guardian:child-export:u_${Math.random()}`;
  let allOk = true;
  for (let i = 0; i < EXPORT_LIMIT; i++) {
    const r = await checkRateLimit(key, EXPORT_LIMIT, MINUTE);
    if (!r.ok) allOk = false;
  }
  const over = await checkRateLimit(key, EXPORT_LIMIT, MINUTE);
  check(allOk, `rate-limit: las primeras ${EXPORT_LIMIT} descargas pasan`);
  check(!over.ok, `rate-limit: la ${EXPORT_LIMIT + 1}ª se rechaza (429)`);
  check(
    !over.ok && over.retryAfterSeconds >= 1 && over.retryAfterSeconds <= 60,
    "rate-limit: retry-after dentro de la ventana",
  );
}

function testPayloadNoCredentials() {
  // EXPORT_CHILD_SELECT nunca proyecta password/hash (viven en `account`).
  const childSelect = EXPORT_CHILD_SELECT.childUser.select as Record<string, unknown>;
  check(
    !("password" in childSelect) && !("passwordHash" in childSelect),
    "select: EXPORT_CHILD_SELECT NUNCA proyecta password/hash",
  );
  // Trae email SOLO para derivar el usuario (no se publica crudo).
  check(
    childSelect.email === true,
    "select: proyecta email solo para derivar el usuario",
  );

  const child: ExportChildInput = {
    name: link.childUser.name,
    email: link.childUser.email,
    birthYear: link.childUser.birthYear,
    role: link.childUser.role,
    createdAt: link.childUser.createdAt,
  };
  const profile = buildChildProfile(child, link.consentAt);

  // El perfil emitido publica el USUARIO, nunca el email sintético crudo.
  check(profile.username === "sofi_2015", "profile: publica el usuario derivado");
  check(
    !("email" in profile) && (profile.username as string) !== CHILD_EMAIL,
    "profile: NUNCA incluye el email crudo del menor",
  );
  check(
    !("password" in profile) && !("passwordHash" in profile),
    "profile: NUNCA incluye password/hash",
  );
  check(
    profile.name === "Sofía" &&
      profile.birthYear === 2015 &&
      profile.role === "child" &&
      profile.consentAt === link.consentAt,
    "profile: proyecta name/birthYear/role/consentAt del titular",
  );
}

function testFilenameSanitization() {
  // Solo [a-z0-9_-] sobrevive; el resto → '_'.
  check(
    sanitizeExportUser("sofi_2015") === "sofi_2015",
    "safeUser: usuario válido queda intacto",
  );
  check(
    sanitizeExportUser('a b/c\\d"e.f') === "a_b_c_d_e_f",
    "safeUser: espacios/barras/comillas/puntos → '_'",
  );
  check(
    sanitizeExportUser("../../etc") === "______etc",
    "safeUser: neutraliza intento de path traversal",
  );
  check(
    sanitizeExportUser('"; DROP TABLE') === "___DROP_TABLE",
    "safeUser: neutraliza inyección en el header",
  );

  const at = new Date("2026-07-10T13:45:00Z");
  check(
    exportFilename("sofi_2015", at) === "simon-datos-sofi_2015-2026-07-10.json",
    "filename: simon-datos-<usuario>-<yyyy-mm-dd>.json",
  );
  check(
    exportFilename('mal"user', at) === "simon-datos-mal_user-2026-07-10.json",
    "filename: sanea el usuario dentro del nombre de archivo",
  );
}

async function main() {
  await testAuthz404();
  await testRateLimit();
  testPayloadNoCredentials();
  testFilenameSanitization();

  done();
}

main();
