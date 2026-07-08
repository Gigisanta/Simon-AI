"use client";

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
