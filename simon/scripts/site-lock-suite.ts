/**
 * Suite ejecutable del candado de sitio (src/lib/site-lock.ts). Sin framework —
 * tsx.
 *
 *   pnpm test site-lock
 *
 * CAMINO CRÍTICO: es la barrera que decide si el sitio entero queda abierto o
 * cerrado en la fase privada. Cubre las cuatro piezas puras y testeables:
 *
 *   1. sign/verify: roundtrip, vencimiento, firma/exp adulterados, secret
 *      distinto, formatos malformados y versión desconocida.
 *   2. timingSafeEqualStr: igual, distinto, largo distinto.
 *   3. isLockExemptPath: qué rutas quedan fuera del candado.
 *   4. decideSiteLock: la decisión final (allow/redirect/unauthorized/
 *      unavailable) para cada combinación de ruta/cookie/secret/entorno.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
import { createChecker } from "./suite-helpers";
import {
  decideSiteLock,
  isLockExemptPath,
  signGateToken,
  timingSafeEqualStr,
  verifyGateToken,
} from "../src/lib/site-lock";

const { check, done } = createChecker("Site-lock suite");

const SECRET = "secreto-de-la-puerta";
const NOW = 1_700_000_000_000;
const FUTURE = NOW + 60_000;

async function testSignVerify() {
  // ---------- Roundtrip: firmado con `secret` verifica con el mismo `secret` ----------
  {
    const token = await signGateToken(SECRET, FUTURE);
    check(
      await verifyGateToken(SECRET, token, NOW),
      "roundtrip: token recién firmado verifica OK",
    );
  }

  // ---------- Token vencido ----------
  {
    const token = await signGateToken(SECRET, NOW - 1);
    check(
      !(await verifyGateToken(SECRET, token, NOW)),
      "vencido: exp <= nowMs rechaza",
    );
  }

  // ---------- Firma adulterada ----------
  {
    const token = await signGateToken(SECRET, FUTURE);
    const [version, exp, sig] = token.split(".");
    const tampered = `${version}.${exp}.${sig!.slice(0, -1)}${sig!.at(-1) === "A" ? "B" : "A"}`;
    check(
      !(await verifyGateToken(SECRET, tampered, NOW)),
      "firma adulterada: rechaza",
    );
  }

  // ---------- Secret distinto ----------
  {
    const token = await signGateToken(SECRET, FUTURE);
    check(
      !(await verifyGateToken("otro-secreto", token, NOW)),
      "secret distinto: rechaza",
    );
  }

  // ---------- exp adulterado (mueve el vencimiento sin re-firmar) ----------
  {
    const token = await signGateToken(SECRET, FUTURE);
    const [version, , sig] = token.split(".");
    const tampered = `${version}.${FUTURE + 1_000_000}.${sig}`;
    check(
      !(await verifyGateToken(SECRET, tampered, NOW)),
      "exp adulterado: la firma ya no matchea el nuevo exp",
    );
  }

  // ---------- Malformados ----------
  const malformed = ["", "v1", "v1.123", "v1.abc.def", "v1.123.sig.extra"];
  for (const bad of malformed) {
    check(
      !(await verifyGateToken(SECRET, bad, NOW)),
      `malformado: "${bad}" rechaza`,
    );
  }

  // ---------- Versión desconocida ----------
  {
    const token = await signGateToken(SECRET, FUTURE);
    const [, exp, sig] = token.split(".");
    const tampered = `v2.${exp}.${sig}`;
    check(
      !(await verifyGateToken(SECRET, tampered, NOW)),
      "versión desconocida: v2 rechaza",
    );
  }
}

function testTimingSafeEqualStr() {
  check(timingSafeEqualStr("abc123", "abc123"), "timingSafeEqualStr: iguales → true");
  check(!timingSafeEqualStr("abc123", "abc124"), "timingSafeEqualStr: distintos (mismo largo) → false");
  check(!timingSafeEqualStr("abc", "abcd"), "timingSafeEqualStr: largo distinto → false");
}

function testIsLockExemptPath() {
  const exempt = ["/gate", "/api/gate", "/api/cron/x", "/robots.txt", "/icon.svg"];
  for (const p of exempt) {
    check(isLockExemptPath(p), `exenta: ${p}`);
  }
  const notExempt = ["/", "/api/chat", "/gatecrash", "/api/cron"];
  for (const p of notExempt) {
    check(!isLockExemptPath(p), `NO exenta: ${p}`);
  }
}

async function testDecideSiteLock() {
  // ---------- Ruta exenta → allow, sin importar cookie/secret ----------
  {
    const d = await decideSiteLock({
      pathname: "/gate",
      cookieValue: undefined,
      secret: undefined,
      isProd: true,
      nowMs: NOW,
    });
    check(d === "allow", "decide: ruta exenta → allow");
  }

  // ---------- Cookie válida → allow ----------
  {
    const token = await signGateToken(SECRET, FUTURE);
    const d = await decideSiteLock({
      pathname: "/",
      cookieValue: token,
      secret: SECRET,
      isProd: true,
      nowMs: NOW,
    });
    check(d === "allow", "decide: cookie válida → allow");
  }

  // ---------- Ruta HTML sin cookie → redirect ----------
  {
    const d = await decideSiteLock({
      pathname: "/",
      cookieValue: undefined,
      secret: SECRET,
      isProd: true,
      nowMs: NOW,
    });
    check(d === "redirect", "decide: HTML sin cookie → redirect");
  }

  // ---------- Ruta API sin cookie → unauthorized ----------
  {
    const d = await decideSiteLock({
      pathname: "/api/chat",
      cookieValue: undefined,
      secret: SECRET,
      isProd: true,
      nowMs: NOW,
    });
    check(d === "unauthorized", "decide: API sin cookie → unauthorized");
  }

  // ---------- Ruta API con cookie mala (vencida) → unauthorized ----------
  {
    const bad = await signGateToken(SECRET, NOW - 1);
    const d = await decideSiteLock({
      pathname: "/api/chat",
      cookieValue: bad,
      secret: SECRET,
      isProd: true,
      nowMs: NOW,
    });
    check(d === "unauthorized", "decide: API con cookie vencida → unauthorized");
  }

  // ---------- Producción sin secret → unavailable (fail-closed) ----------
  {
    const d = await decideSiteLock({
      pathname: "/",
      cookieValue: undefined,
      secret: undefined,
      isProd: true,
      nowMs: NOW,
    });
    check(d === "unavailable", "decide: prod sin secret → unavailable (fail-closed)");
  }

  // ---------- Dev sin secret → allow (candado inactivo, DX local) ----------
  {
    const d = await decideSiteLock({
      pathname: "/",
      cookieValue: undefined,
      secret: undefined,
      isProd: false,
      nowMs: NOW,
    });
    check(d === "allow", "decide: dev sin secret → allow");
  }
}

async function main() {
  await testSignVerify();
  testTimingSafeEqualStr();
  testIsLockExemptPath();
  await testDecideSiteLock();
  done();
}

main();
