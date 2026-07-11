/**
 * Datos del directorio "Cerca tuyo" — fuente única.
 * Importado por prisma/seed.ts (carga a DB).
 *
 * REGLA DE SEGURIDAD: solo los recursos `reviewed: true` se muestran en el
 * producto (el endpoint filtra por eso). Las LÍNEAS NACIONALES vienen
 * verificadas de docs/research-safety.md §3.4 → `reviewed: true`. Los recursos
 * PROVINCIALES (hospitales, servicios locales) requieren validación humana del
 * teléfono/horario antes de publicarse → `reviewed: false` hasta entonces.
 * NUNCA marcar reviewed:true un dato provincial sin confirmarlo contra la
 * fuente oficial: un número mal puede dejar a una familia sin ayuda en crisis.
 */

export type HelpResourceSeed = {
  slug: string;
  name: string;
  // "crisis" | "salud_mental" | "discapacidad" | "escuela" | "linea" | "ong"
  kind: string;
  // "nacional" | "neuquen" | "rionegro"
  province: string;
  localidad?: string;
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  whatsapp?: string;
  hours?: string;
  cost?: string; // "gratis" | "obra_social" | "arancel"
  takesChildren?: boolean;
  noAppointment?: boolean;
  url?: string;
  notes?: string;
  source?: string;
  reviewed?: boolean;
};

// --- Líneas nacionales VERIFICADAS (research-safety.md §3.4) → reviewed:true ---
const NACIONALES: HelpResourceSeed[] = [
  {
    slug: "emergencias-911",
    name: "Emergencias (911)",
    kind: "crisis",
    province: "nacional",
    phone: "911",
    hours: "24 hs",
    cost: "gratis",
    noAppointment: true,
    notes: "Ante peligro inmediato, llamar SIEMPRE primero al 911.",
    source: "Sistema de emergencias nacional",
    reviewed: true,
  },
  {
    slug: "cas-135",
    name: "Centro de Asistencia al Suicida (CAS)",
    kind: "crisis",
    province: "nacional",
    phone: "135 (CABA/GBA) · 0800-345-1435 (todo el país)",
    hours: "Todos los días, 8:00 a 0:00 hs",
    cost: "gratis",
    noAppointment: true,
    url: "https://www.asistenciaalsuicida.org.ar/",
    notes: "Prevención del suicidio. Gratis y anónimo. No cubre la madrugada: fuera de ese horario, 911 o guardia.",
    source: "asistenciaalsuicida.org.ar",
    reviewed: true,
  },
  {
    slug: "linea-102",
    name: "Línea 102 — Niñez y adolescencia",
    kind: "linea",
    province: "nacional",
    phone: "102",
    hours: "Varía por provincia (no es servicio de emergencia)",
    cost: "gratis",
    takesChildren: true,
    noAppointment: true,
    url: "https://www.argentina.gob.ar/capital-humano/familia/ninez-y-adolescencia/linea-102",
    notes: "Escucha y protección de derechos de chicas, chicos y adolescentes.",
    source: "argentina.gob.ar",
    reviewed: true,
  },
  {
    slug: "linea-137",
    name: "Línea 137 — Violencia familiar y sexual",
    kind: "linea",
    province: "nacional",
    phone: "137",
    whatsapp: "11-3133-1000",
    hours: "24 hs",
    cost: "gratis",
    noAppointment: true,
    url: "https://www.argentina.gob.ar/justicia/violencia-familiar-sexual",
    source: "argentina.gob.ar",
    reviewed: true,
  },
  {
    slug: "linea-144",
    name: "Línea 144 — Violencia de género",
    kind: "linea",
    province: "nacional",
    phone: "144",
    hours: "24 hs",
    cost: "gratis",
    noAppointment: true,
    url: "https://www.argentina.gob.ar/generos/linea-144",
    source: "argentina.gob.ar",
    reviewed: true,
  },
];

// --- Provinciales: estructura real, PENDIENTES de validar teléfono/horario ---
// reviewed:false → NO se muestran hasta que una persona confirme los datos.
// Se cargan igual para (a) dejar el esqueleto listo y (b) que el equipo complete
// y valide. NO se inventan teléfonos: si no está confirmado, queda en null.
const PROVINCIALES: HelpResourceSeed[] = [
  {
    slug: "nqn-hospital-castro-rendon-salud-mental",
    name: "Hospital Provincial Neuquén «Dr. Castro Rendón» — Salud Mental",
    kind: "salud_mental",
    province: "neuquen",
    localidad: "Neuquén capital",
    cost: "gratis",
    takesChildren: true,
    url: "https://www.saludneuquen.gob.ar/",
    notes: "PENDIENTE validar: teléfono, horario y estado de admisión ambulatoria.",
    source: "Ministerio de Salud de Neuquén",
    reviewed: false,
  },
  {
    slug: "nqn-linea-102-provincial",
    name: "Línea 102 Neuquén (niñez y adolescencia)",
    kind: "linea",
    province: "neuquen",
    localidad: "Provincia de Neuquén",
    phone: "102",
    cost: "gratis",
    takesChildren: true,
    noAppointment: true,
    notes: "PENDIENTE validar horario de atención provincial.",
    source: "Provincia de Neuquén",
    reviewed: false,
  },
  {
    slug: "rn-salud-mental-provincial",
    name: "Salud Mental — Ministerio de Salud de Río Negro",
    kind: "salud_mental",
    province: "rionegro",
    localidad: "Provincia de Río Negro",
    cost: "gratis",
    takesChildren: true,
    url: "https://salud.rionegro.gov.ar/",
    notes: "PENDIENTE validar: efector por localidad, teléfono y horario.",
    source: "Ministerio de Salud de Río Negro",
    reviewed: false,
  },
  {
    slug: "rn-linea-102-provincial",
    name: "Línea 102 Río Negro (niñez y adolescencia)",
    kind: "linea",
    province: "rionegro",
    localidad: "Provincia de Río Negro",
    phone: "102",
    cost: "gratis",
    takesChildren: true,
    noAppointment: true,
    notes: "PENDIENTE validar horario de atención provincial.",
    source: "Provincia de Río Negro",
    reviewed: false,
  },
];

export const HELP_RESOURCES: HelpResourceSeed[] = [...NACIONALES, ...PROVINCIALES];
