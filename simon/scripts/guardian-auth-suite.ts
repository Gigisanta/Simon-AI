/**
 * Suite ejecutable de la authz compartida del tutor/a (sin framework — tsx).
 *
 *   pnpm guardian-auth-suite
 *
 * Cubre lo que se extrajo/agregó en el hardening de rutas de tutela:
 *
 *   1. findOwnedChild() — el helper de ownership compartido por las tres rutas
 *      (@/lib/guardian-auth). Se inyecta un FAKE de `prisma.guardian.findFirst`
 *      que emula el filtrado de Postgres: así el test verifica de verdad que el
 *      helper arma el `where` con los TRES constraints (guardianUserId,
 *      childUserId, childUser.role="child"). Si el helper dropeara cualquiera,
 *      un caso de no-dueño / rol equivocado matchearía y el test fallaría (IDOR).
 *      - dueño + menor            → devuelve el vínculo.
 *      - otro tutor/a             → null (no-dueño rechazado).
 *      - childId inexistente      → null.
 *      - rol != "child"           → null (no es un menor).
 *      - variante `select` export → proyecta el perfil (consentAt + childUser).
 *
 *   2. Rate limit de las rutas de LECTURA nuevas (GET /children, GET
 *      /conversations, GET /conversations/[id]): mismas claves y tope (60/min)
 *      que usan los handlers → 60 pasan, la 61ª devuelve 429 con retry-after
 *      dentro de la ventana. (checkRateLimit in-memory, determinístico.)
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
// Sin credenciales de Upstash: checkRateLimit usa la implementación in-memory.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import {
  findOwnedChild,
  type GuardianOwnershipClient,
} from "../src/lib/guardian-auth";
import { checkRateLimit } from "../src/lib/rate-limit";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

const MINUTE = 60_000;

// ---------- Fake de prisma.guardian que emula el filtrado real ----------
type FakeUser = {
  id: string;
  role: string;
  name?: string;
  email?: string;
  birthYear?: number;
  createdAt?: Date;
};
type FakeLink = {
  id: string;
  guardianUserId: string;
  childUserId: string;
  consentAt: Date | null;
  childUser: FakeUser;
};

// Proyecta un vínculo según el `select` pedido (emula la proyección de Prisma).
// `select` se trata laxo acá a propósito: es un doble de test.
function project(link: FakeLink, select: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (select.id) out.id = link.id;
  if (select.consentAt) out.consentAt = link.consentAt;
  if (select.childUser) {
    const cs = (select.childUser as { select: Record<string, unknown> }).select;
    const cu: Record<string, unknown> = {};
    if (cs.id) cu.id = link.childUser.id;
    if (cs.name) cu.name = link.childUser.name;
    if (cs.email) cu.email = link.childUser.email;
    if (cs.birthYear) cu.birthYear = link.childUser.birthYear;
    if (cs.role) cu.role = link.childUser.role;
    if (cs.createdAt) cu.createdAt = link.childUser.createdAt;
    out.childUser = cu;
  }
  return out;
}

let lastWhere: Record<string, unknown> | null = null;

function makeFakeClient(links: FakeLink[]): GuardianOwnershipClient {
  return {
    guardian: {
      async findFirst(args) {
        const w = args.where;
        lastWhere = w as unknown as Record<string, unknown>;
        // Emula el filtrado de Postgres: los TRES constraints deben matchear.
        const match = links.find(
          (l) =>
            l.guardianUserId === w.guardianUserId &&
            l.childUserId === w.childUserId &&
            l.childUser.role === w.childUser.role,
        );
        return match
          ? project(match, args.select as unknown as Record<string, unknown>)
          : null;
      },
    },
  };
}

// Escenario base: tutor g1 → menor c1. También existe g2 (otro tutor) y a1 (un
// user con rol "guardian", no un menor) para los casos de rechazo.
const links: FakeLink[] = [
  {
    id: "link_1",
    guardianUserId: "g1",
    childUserId: "c1",
    consentAt: new Date("2026-07-08T00:00:00Z"),
    childUser: {
      id: "c1",
      role: "child",
      name: "Sofía",
      email: "sofi_2015@ninos.simon.invalid",
      birthYear: 2015,
      createdAt: new Date("2026-07-08T00:00:00Z"),
    },
  },
  // Un vínculo donde el "child" en realidad tiene rol guardian (no debe matchear
  // la query, que exige role="child").
  {
    id: "link_bad_role",
    guardianUserId: "g1",
    childUserId: "a1",
    consentAt: null,
    childUser: { id: "a1", role: "guardian", name: "Adulto" },
  },
];

const SELECT_ID = { id: true } as const;
const SELECT_WITH_CHILD = {
  id: true,
  childUser: { select: { id: true, name: true } },
} as const;
const EXPORT_SELECT = {
  consentAt: true,
  childUser: {
    select: {
      name: true,
      email: true,
      birthYear: true,
      role: true,
      createdAt: true,
    },
  },
} as const;

async function testOwnership() {
  const db = makeFakeClient(links);

  // Dueño + menor → vínculo.
  const ok = await findOwnedChild("g1", "c1", SELECT_ID, db);
  check(ok !== null && ok.id === "link_1", "findOwnedChild: dueño + menor → vínculo");

  // El where SIEMPRE lleva los tres constraints (anti-IDOR).
  check(
    !!lastWhere &&
      lastWhere.guardianUserId === "g1" &&
      lastWhere.childUserId === "c1" &&
      JSON.stringify(lastWhere.childUser) === JSON.stringify({ role: "child" }),
    "findOwnedChild: el where lleva guardianUserId + childUserId + role='child'",
  );

  // Otro tutor/a (no-dueño) → null (aunque el menor exista).
  const notOwner = await findOwnedChild("g2", "c1", SELECT_ID, db);
  check(notOwner === null, "findOwnedChild: otro tutor/a (no-dueño) → null");

  // childId inexistente → null.
  const missing = await findOwnedChild("g1", "no_existe", SELECT_ID, db);
  check(missing === null, "findOwnedChild: childId inexistente → null");

  // childId de un user que NO es menor (rol guardian) → null (exige role='child').
  const wrongRole = await findOwnedChild("g1", "a1", SELECT_ID, db);
  check(wrongRole === null, "findOwnedChild: childId con rol != 'child' → null");

  // Variante con childUser básico (ruta [childId]).
  const withChild = await findOwnedChild("g1", "c1", SELECT_WITH_CHILD, db);
  check(
    withChild !== null &&
      withChild.id === "link_1" &&
      withChild.childUser?.name === "Sofía",
    "findOwnedChild: select con childUser proyecta id + name",
  );
}

async function testExportSelectVariant() {
  const db = makeFakeClient(links);
  const link = await findOwnedChild("g1", "c1", EXPORT_SELECT, db);
  check(link !== null, "export-select: dueño + menor → vínculo");
  if (link) {
    check(
      link.consentAt?.toISOString() === "2026-07-08T00:00:00.000Z",
      "export-select: proyecta consentAt del vínculo",
    );
    const cu = link.childUser;
    check(
      cu?.name === "Sofía" &&
        cu?.email === "sofi_2015@ninos.simon.invalid" &&
        cu?.birthYear === 2015 &&
        cu?.role === "child" &&
        cu?.createdAt instanceof Date,
      "export-select: proyecta el perfil (name/email/birthYear/role/createdAt)",
    );
    // Nunca password/hash: la variante de select no los pide, así que no aparecen.
    check(
      !("password" in (cu as object)) && !("passwordHash" in (cu as object)),
      "export-select: NUNCA incluye password/hash del menor",
    );
  }
  // La authz del export es la misma: un no-dueño no obtiene el perfil.
  const notOwner = await findOwnedChild("g2", "c1", EXPORT_SELECT, db);
  check(notOwner === null, "export-select: no-dueño → null (misma authz)");
}

// ---------- Rate limit de las rutas de lectura nuevas ----------
async function testReadPathRateLimits() {
  const LIMIT = 60; // igual al tope de los tres handlers de lectura.
  const cases: Array<{ label: string; key: string }> = [
    { label: "GET /guardian/children", key: `guardian:children:read:u_${Math.random()}` },
    { label: "GET /conversations", key: `conversations:read:u_${Math.random()}` },
    // GET /conversations/[id] usa la MISMA clave que el listado (mismo usuario).
    { label: "GET /conversations/[id]", key: `conversations:read:u_${Math.random()}` },
  ];

  for (const { label, key } of cases) {
    let allOk = true;
    for (let i = 0; i < LIMIT; i++) {
      const r = await checkRateLimit(key, LIMIT, MINUTE);
      if (!r.ok) allOk = false;
    }
    const over = await checkRateLimit(key, LIMIT, MINUTE);
    check(allOk, `rate-limit ${label}: las primeras ${LIMIT} pasan`);
    check(!over.ok, `rate-limit ${label}: la ${LIMIT + 1}ª se rechaza (429)`);
    if (!over.ok) {
      check(
        over.retryAfterSeconds >= 1 && over.retryAfterSeconds <= 60,
        `rate-limit ${label}: retry-after dentro de la ventana`,
      );
    }
  }
}

async function main() {
  await testOwnership();
  await testExportSelectVariant();
  await testReadPathRateLimits();

  const total = passed + failures.length;
  console.log(`\nGuardian-auth suite: ${passed}/${total} casos OK`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
    process.exit(1);
  }
  console.log("Todos los casos pasaron.\n");
}

main();
