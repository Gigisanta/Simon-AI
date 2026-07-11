import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import {
  deliverExistingAccountEmail,
  deliverResetPasswordEmail,
  deliverVerificationEmail,
} from "@/lib/email";
import {
  consumeChildSignupAuthorization,
  isChildEmail,
} from "@/lib/guardian";
import { assertProdEnv } from "@/lib/env-check";
import { upstashSecondaryStorage } from "@/lib/auth-secondary-storage";

// Bootstrap: en producción valida la config mínima al primer import
// server-side (lanza si faltan BETTER_AUTH_SECRET / BETTER_AUTH_URL https).
assertProdEnv();

// F3 (A1): con env de Upstash, el rate limit de better-auth pasa a storage
// COMPARTIDO entre instancias (ver lib/auth-secondary-storage.ts). Sin env,
// undefined → comportamiento actual intacto (memory por instancia).
const secondaryStorage = upstashSecondaryStorage();

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // CSRF/origen: solo se confía en el origin propio de la app (B2).
  trustedOrigins: process.env.BETTER_AUTH_URL
    ? [process.env.BETTER_AUTH_URL]
    : [],
  databaseHooks: {
    user: {
      create: {
        // C1 — Un cliente externo NO puede crear cuentas de menores.
        //
        // El endpoint público POST /api/auth/sign-up/email aceptaría cualquier
        // email, incluidos los sintéticos `@ninos.simon.invalid`, y eso
        // permitiría fabricar cuentas "de menor" sin tutor/a ni consentimiento.
        //
        // Este hook corre en TODA creación de usuario (better-auth 1.6:
        // databaseHooks.user.create.before) y rechaza los emails sintéticos,
        // SALVO que el alta haya sido autorizada por el flujo server-side del
        // tutor/a: app/api/guardian/children/route.ts llama a
        // `authorizeChildSignup(email)` (registro en memoria del proceso, de
        // un solo uso y con TTL de 30s — ver lib/guardian.ts) inmediatamente
        // antes de `auth.api.signUpEmail`, y acá se consume. La señal vive
        // solo en la memoria del servidor: no hay header, flag de body ni
        // cookie que un cliente externo pueda replicar.
        before: async (user) => {
          if (isChildEmail(user.email)) {
            if (!consumeChildSignupAuthorization(user.email)) {
              throw new APIError("BAD_REQUEST", {
                message: "No es posible registrarse con ese email.",
              });
            }
          }
          return { data: user };
        },
      },
    },
  },
  user: {
    // Campos extra del modelo tutor-first. `input: false`: NUNCA se aceptan
    // desde el cliente (rol y edad se fijan server-side); evitamos que alguien
    // se auto-asigne role="child"/"guardian" en el signUp.
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "guardian",
        input: false,
      },
      birthYear: {
        type: "number",
        required: false,
        input: false,
      },
      hasDiagnosis: {
        type: "boolean",
        required: false,
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // El tutor/a debe verificar su email antes de poder iniciar sesión (M-P1).
    // NO bloquea a los menores: se crean con `emailVerified: true` server-side
    // (su email sintético `.invalid` jamás es verificable), así que pasan este
    // chequeo — better-auth solo mira `emailVerified` (ver sign-in).
    //
    // ENUMERACIÓN DE CUENTAS (M-S7 ciclo 18): con `requireEmailVerification`
    // activo, better-auth 1.6 YA enmascara el alta de un email duplicado
    // server-side (ver node_modules/.../routes/sign-up.mjs): en vez del 422
    // `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, devuelve un ÉXITO SINTÉTICO
    // (HTTP 200 con un `user` fake y `token: null`) INDISTINGUIBLE de un alta
    // real — mismo status, mismo shape de body (el builder aplica los defaults
    // del schema: role="guardian", birthYear=null, emailVerified=false, id/fechas
    // frescos, igual que un alta nueva), y hashea la contraseña en AMBOS caminos
    // para achicar la diferencia de timing (el hash domina; el residual es solo
    // los 2 INSERT que el alta nueva hace de más → el camino duplicado NO es más
    // lento ni retorna en <10ms). El status/body/timing los cubre la librería;
    // acá solo falta avisarle al dueño legítimo del email, vía el hook de abajo.
    requireEmailVerification: true,
    // Aviso al dueño del email cuando alguien intenta registrarse con una
    // dirección ya registrada (M-S7). Cierra el patrón anti-enumeración: el que
    // intenta el alta ve un éxito sintético (no aprende nada); el dueño real
    // recibe un "ya tenés cuenta, iniciá sesión / restablecé la contraseña".
    // better-auth solo lo invoca cuando `requireEmailVerification: true` (o
    // `autoSignIn: false`) — justo el modo en que enmascara el duplicado — y lo
    // corre en background (no bloquea ni cambia el timing de la respuesta).
    //
    // Los menores usan email sintético `@ninos.simon.invalid` (no ruteable): si
    // un duplicado de menor llegara al signup público, NO se intenta enviar nada
    // (mismo guard que verificación/reseteo). El alta server-side del tutor/a no
    // dispara este hook: hace un pre-check de duplicado y responde 409 ANTES de
    // llamar a `signUpEmail`.
    async onExistingUserSignUp({ user }) {
      if (isChildEmail(user.email)) return;
      // No propagamos errores: un fallo del proveedor no debe afectar la
      // respuesta del signup (better-auth ya lo corre en background).
      await deliverExistingAccountEmail(user.email);
    },
    // Reseteo de contraseña — SOLO tutores/as. Los menores no tienen email real
    // (su `@ninos.simon.invalid` no es ruteable ni verificable), así que su
    // solicitud se rechaza en silencio: no se envía nada y no se filtra que la
    // cuenta existe. Mismo transporte no-bloqueante que la verificación
    // (deliverEmail: en producción sin RESEND_API_KEY el token NUNCA se loguea).
    //
    // Se activa `revokeSessionsOnPasswordReset`: al resetear la contraseña,
    // better-auth revoca TODAS las sesiones de ESE userId (solo del que resetea).
    // No toca al hijo: tutor/a e hijos son userIds distintos, cada uno con sus
    // propias sesiones, así que el reset del tutor/a jamás alcanza las del menor.
    // El vector que cierra es el clásico: si una sesión del tutor/a fue robada
    // (cookie/token filtrado), el reseteo de contraseña debe expulsarla — sin
    // esto, la sesión comprometida sobrevive al cambio de credencial y el ataque
    // persiste pese a que el dueño legítimo ya "recuperó" la cuenta.
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      if (isChildEmail(user.email)) return;
      // No propagamos errores: un fallo del proveedor no debe romper el flujo
      // (better-auth corre esto en background; el tutor/a puede reintentar).
      await deliverResetPasswordEmail(user.email, url);
    },
  },
  emailVerification: {
    // Enviar el email de verificación al registrarse.
    sendOnSignUp: true,
    // Al hacer clic en el link, iniciar sesión automáticamente.
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      // Los menores usan email sintético en `.invalid`: no es ruteable ni
      // verificable. No intentamos enviar nada (su cuenta ya se marca como
      // verificada al crearla).
      if (isChildEmail(user.email)) return;
      // No propagamos errores: un fallo del proveedor no debe romper el
      // registro (se loguea; el tutor/a puede reintentar la verificación).
      await deliverVerificationEmail(user.email, url);
    },
  },
  // F3 (A1): secondaryStorage global solo si hay Upstash. Con él, better-auth
  // movería las sesiones a Redis; `storeSessionInDatabase: true` lo evita:
  // Postgres sigue siendo la fuente de verdad de las sesiones (un miss o caída
  // de Redis cae a la DB — internal-adapter de better-auth 1.6) y Redis queda
  // para lo que se busca acá: el rate limit compartido.
  ...(secondaryStorage ? { secondaryStorage } : {}),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24,
    ...(secondaryStorage ? { storeSessionInDatabase: true } : {}),
  },
  // Frena brute-force de contraseñas y spam de registros.
  // (better-auth lo activa solo en producción por defecto; acá es explícito
  // y con ventana más estricta para los endpoints sensibles.)
  //
  // A1: con Upstash configurado (secondaryStorage) el contador es COMPARTIDO
  // entre instancias serverless ("secondary-storage"); sin env queda el
  // storage "memory" por instancia, como antes.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    ...(secondaryStorage ? { storage: "secondary-storage" as const } : {}),
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      // Solicitud de reseteo de contraseña (authClient.requestPasswordReset →
      // endpoint /request-password-reset de better-auth 1.6). Sin esta regla el
      // path caería al tope global (30/60s), suficiente para spamear con emails
      // de reseteo a una víctima. 3/60s lo frena. El match de customRules es por
      // path EXACTO relativo al handler de auth (sin basePath), igual que las de
      // arriba. Nota: 1.6 ya trae una special-rule interna 60/3 para este path;
      // fijarla acá la vuelve explícita e independiente de internals de la lib.
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
});
