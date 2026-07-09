import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { deliverVerificationEmail } from "@/lib/email";
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
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // El tutor/a debe verificar su email antes de poder iniciar sesión (M-P1).
    // NO bloquea a los menores: se crean con `emailVerified: true` server-side
    // (su email sintético `.invalid` jamás es verificable), así que pasan este
    // chequeo — better-auth solo mira `emailVerified` (ver sign-in).
    requireEmailVerification: true,
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
    },
  },
});
