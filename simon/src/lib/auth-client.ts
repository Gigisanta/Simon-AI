"use client";

// EXENCIÓN DE TEST (intencional): este módulo no tiene suite propia. Es solo
// wiring declarativo de better-auth para el cliente — instancia authClient con
// inferAdditionalFields y re-exporta sus hooks. No contiene lógica de decisión,
// validación ni ramas propias que testear; su corrección la garantiza el tipado
// (`typeof auth`) y la librería. Un test acá solo verificaría que better-auth
// funciona, no nuestro código. La lógica de auth con sustancia (rate-limit
// storage, authz de guardian, alta de menores) sí está cubierta en sus suites.

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "@/lib/auth";

// `inferAdditionalFields` expone en el cliente los campos extra del `User`
// (role, birthYear) definidos server-side, con tipado. El import es type-only,
// así que no arrastra código de servidor al bundle del cliente.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
