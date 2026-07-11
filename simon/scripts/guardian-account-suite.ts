/**
 * Suite de la autoeliminación de la cuenta del tutor/a + sus menores en cascada
 * (DELETE /api/guardian/account). Sin framework — tsx.
 *
 *   pnpm test guardian-account
 *
 * CAMINO CRÍTICO (borrado irreversible de datos de menores + re-auth). Cubre la
 * lógica pura extraída en src/lib/guardian-account.ts, con las dependencias de
 * I/O (verifyPassword / delete / count / revoke) inyectadas como dobles
 * determinísticos:
 *
 *   (1) Schema del body: confirm faltante / confirm:false / password vacía /
 *       password > 72 → parse falla (la ruta responde 400); { confirm:true, pass } OK.
 *   (2) Contraseña incorrecta (verifyPassword lanza) → 401, sin tocar la DB ni
 *       revocar sesiones.
 *   (3) Transacción exitosa SIN hijos → 200 { deleted: {guardian:1, children:0} },
 *       revokeSessions SOLO para el tutor/a.
 *   (4) Transacción exitosa CON hijos → 200 { children:N }, revokeSessions para el
 *       tutor/a + cada menor.
 *   (5) P2025 en el borrado (doble-submit) → 200 { ok, alreadyDeleted } y NO se
 *       revocan sesiones (la primera request ya lo hizo).
 *   (6) Otro error de la transacción → 500 (mensaje neutro), sin revocar.
 *   (7) Conteo post-borrado > 0 (borrado incompleto) → 500 (mensaje de incompleto),
 *       sin revocar.
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { Prisma } from "../src/generated/prisma/client";
import {
  accountDeleteSchema,
  deleteGuardianAccount,
  type AccountDeleteDeps,
  type AccountLeftovers,
  PASSWORD_INCORRECT_MESSAGE,
  ACCOUNT_DELETE_FAILED_MESSAGE,
  ACCOUNT_DELETE_INCOMPLETE_MESSAGE,
} from "../src/lib/guardian-account";

const { check, done } = createChecker("Guardian-account suite");

const GUARDIAN_ID = "g1";
const NO_LEFTOVERS: AccountLeftovers = { guardian: 0, children: 0, links: 0 };

// Fábrica de deps con spies. Cada override reemplaza el doble por defecto (que
// resuelve al camino feliz). `revoked` registra el orden de revocación de sesiones.
type Spies = {
  revoked: string[];
  deletedWith: string[][];
  countedWith: string[][];
};
function makeDeps(
  childIds: string[],
  overrides: Partial<AccountDeleteDeps> = {},
): { deps: AccountDeleteDeps; spies: Spies } {
  const spies: Spies = { revoked: [], deletedWith: [], countedWith: [] };
  const deps: AccountDeleteDeps = {
    guardianUserId: GUARDIAN_ID,
    verifyPassword: async () => {},
    findChildIds: async () => childIds,
    deleteAccounts: async (ids) => {
      spies.deletedWith.push(ids);
    },
    countLeftovers: async (ids) => {
      spies.countedWith.push(ids);
      return NO_LEFTOVERS;
    },
    revokeSessions: async (userId) => {
      spies.revoked.push(userId);
    },
    ...overrides,
  };
  return { deps, spies };
}

// ---------- (1) Schema del body (confirm + password) ----------
{
  check(
    accountDeleteSchema.safeParse({ password: "hunter2" }).success === false,
    "schema: confirm faltante → falla (la ruta responde 400)",
  );
  check(
    accountDeleteSchema.safeParse({ confirm: false, password: "hunter2" }).success === false,
    "schema: confirm:false → falla (exige el literal true)",
  );
  check(
    accountDeleteSchema.safeParse({ confirm: true }).success === false,
    "schema: password faltante → falla",
  );
  check(
    accountDeleteSchema.safeParse({ confirm: true, password: "" }).success === false,
    "schema: password vacía → falla",
  );
  check(
    accountDeleteSchema.safeParse({ confirm: true, password: "x".repeat(73) }).success === false,
    "schema: password > 72 → falla",
  );
  check(
    accountDeleteSchema.safeParse({ confirm: true, password: "hunter2" }).success === true,
    "schema: { confirm:true, password } válido → OK",
  );
}

async function main() {
  // ---------- (2) Contraseña incorrecta → 401, sin DB ni revoke ----------
  {
    const { deps, spies } = makeDeps(["c1"], {
      verifyPassword: async () => {
        throw new Error("bad password");
      },
    });
    const r = await deleteGuardianAccount(deps);
    check(r.status === 401, "contraseña incorrecta → 401");
    check(r.body.error === PASSWORD_INCORRECT_MESSAGE, "401 → mensaje 'contraseña no es correcta'");
    check(
      spies.deletedWith.length === 0 && spies.revoked.length === 0,
      "401 → NO borra ni revoca (aborta en la re-auth)",
    );
  }

  // ---------- (3) Éxito SIN hijos ----------
  {
    const { deps, spies } = makeDeps([]);
    const r = await deleteGuardianAccount(deps);
    check(r.status === 200, "éxito sin hijos → 200");
    check(
      JSON.stringify(r.body) === JSON.stringify({ ok: true, deleted: { guardian: 1, children: 0 } }),
      "éxito sin hijos → { ok, deleted: {guardian:1, children:0} }",
    );
    check(
      spies.revoked.length === 1 && spies.revoked[0] === GUARDIAN_ID,
      "éxito sin hijos → revokeSessions SOLO para el tutor/a",
    );
    check(
      spies.deletedWith.length === 1 && spies.deletedWith[0]!.length === 0,
      "éxito sin hijos → deleteAccounts recibe lista vacía de hijos",
    );
  }

  // ---------- (4) Éxito CON hijos ----------
  {
    const kids = ["c1", "c2", "c3"];
    const { deps, spies } = makeDeps(kids);
    const r = await deleteGuardianAccount(deps);
    check(r.status === 200, "éxito con hijos → 200");
    check(
      JSON.stringify(r.body) === JSON.stringify({ ok: true, deleted: { guardian: 1, children: 3 } }),
      "éxito con hijos → deleted.children = 3",
    );
    // revoke: tutor/a + cada menor, exactamente una vez cada uno.
    check(
      spies.revoked.length === 4 &&
        spies.revoked.includes(GUARDIAN_ID) &&
        kids.every((k) => spies.revoked.includes(k)),
      "éxito con hijos → revokeSessions para el tutor/a + cada menor",
    );
    // Los IDs de hijos fluyen a deleteAccounts y countLeftovers.
    check(
      JSON.stringify(spies.deletedWith[0]) === JSON.stringify(kids) &&
        JSON.stringify(spies.countedWith[0]) === JSON.stringify(kids),
      "éxito con hijos → los childIds fluyen a deleteAccounts y countLeftovers",
    );
  }

  // ---------- (5) P2025 en el borrado (doble-submit) → idempotente ----------
  {
    const p2025 = new Prisma.PrismaClientKnownRequestError("record not found", {
      code: "P2025",
      clientVersion: "test",
    });
    const { deps, spies } = makeDeps(["c1"], {
      deleteAccounts: async () => {
        throw p2025;
      },
    });
    const r = await deleteGuardianAccount(deps);
    check(r.status === 200, "P2025 → 200 (éxito idempotente)");
    check(
      JSON.stringify(r.body) === JSON.stringify({ ok: true, alreadyDeleted: true }),
      "P2025 → { ok, alreadyDeleted:true }",
    );
    check(
      spies.revoked.length === 0 && spies.countedWith.length === 0,
      "P2025 → NO revoca ni re-verifica (la primera request ya lo hizo)",
    );
  }

  // ---------- (6) Otro error de la transacción → 500 ----------
  {
    const p2003 = new Prisma.PrismaClientKnownRequestError("fk violation", {
      code: "P2003",
      clientVersion: "test",
    });
    const { deps, spies } = makeDeps(["c1"], {
      deleteAccounts: async () => {
        throw p2003;
      },
    });
    const r = await deleteGuardianAccount(deps);
    check(r.status === 500, "error no-P2025 en la transacción → 500");
    check(r.body.error === ACCOUNT_DELETE_FAILED_MESSAGE, "500 → mensaje neutro de fallo");
    check(
      r.body.error !== ACCOUNT_DELETE_INCOMPLETE_MESSAGE,
      "500 de fallo ≠ 500 de incompleto (contratos distintos)",
    );
    check(spies.revoked.length === 0, "500 de fallo → NO revoca sesiones");
  }

  // ---------- (7) Conteo post-borrado > 0 (incompleto) → 500 ----------
  {
    const { deps, spies } = makeDeps(["c1"], {
      countLeftovers: async (): Promise<AccountLeftovers> => ({
        guardian: 0,
        children: 1, // quedó un menor sin borrar → supresión NO real.
        links: 0,
      }),
    });
    const r = await deleteGuardianAccount(deps);
    check(r.status === 500, "borrado incompleto (restos > 0) → 500");
    check(
      r.body.error === ACCOUNT_DELETE_INCOMPLETE_MESSAGE,
      "500 → mensaje de 'eliminación incompleta'",
    );
    check(spies.revoked.length === 0, "borrado incompleto → NO revoca sesiones");
  }

  done();
}

main();
