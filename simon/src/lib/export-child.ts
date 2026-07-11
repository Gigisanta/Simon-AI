/**
 * Piezas puras del export de datos del menor (GET
 * /api/guardian/children/[childId]/export): la proyección de campos autorizada,
 * la sanitización del nombre de archivo y el armado del bloque `profile`.
 * Extraídas de la ruta para poder testear sin DB dos invariantes del camino
 * crítico (datos de un menor):
 *   - el payload NUNCA expone password/hash ni el email sintético crudo del menor
 *     (el perfil publica el "usuario" derivado, no el email);
 *   - el nombre de archivo se sanea a `[a-z0-9_-]` para que un valor guiado por
 *     datos no pueda romper/inyectar el header Content-Disposition.
 */
import { usernameFromEmail } from "@/lib/guardian";

/**
 * Proyección del vínculo para el export: consentAt + perfil del menor. Trae el
 * `email` SOLO para derivar el "usuario" visible (usernameFromEmail); nunca se
 * publica crudo. NUNCA incluye password/hashes (viven en `account`, no se leen).
 * La autorización (los tres constraints del where) vive en findOwnedChild.
 */
export const EXPORT_CHILD_SELECT = {
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

/** Perfil del menor tal como se emite en el export (usuario, no email crudo). */
export interface ExportedChildProfile {
  name: string;
  username: string;
  birthYear: number | null;
  role: string;
  createdAt: Date;
  consentAt: Date | null;
}

/** Datos del menor que llegan de la proyección EXPORT_CHILD_SELECT. */
export interface ExportChildInput {
  name: string;
  email: string;
  birthYear: number | null;
  role: string;
  createdAt: Date;
}

/**
 * Arma el bloque `profile` del payload: publica el "usuario" derivado del email
 * sintético, NUNCA el email crudo. El caller pasa el `consentAt` del vínculo.
 */
export function buildChildProfile(
  child: ExportChildInput,
  consentAt: Date | null,
): ExportedChildProfile {
  return {
    name: child.name,
    username: usernameFromEmail(child.email),
    birthYear: child.birthYear,
    role: child.role,
    createdAt: child.createdAt,
    consentAt,
  };
}

/**
 * Sanea el "usuario" a `[a-z0-9_-]` (case-insensitive) reemplazando el resto por
 * `_`. Aunque el schema del alta ya restringe el username, nunca se deja que un
 * valor guiado por datos rompa el header Content-Disposition.
 */
export function sanitizeExportUser(username: string): string {
  return username.replace(/[^a-z0-9_-]/gi, "_");
}

/** Nombre del archivo de descarga: `simon-datos-<usuario saneado>-<yyyy-mm-dd>.json`. */
export function exportFilename(username: string, exportedAt: Date): string {
  const day = exportedAt.toISOString().slice(0, 10);
  return `simon-datos-${sanitizeExportUser(username)}-${day}.json`;
}
