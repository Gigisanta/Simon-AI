/**
 * Datos de las guías de trámites ("Mis trámites") — fuente única.
 * Importado por prisma/seed.ts.
 *
 * CONTENIDO ORIENTATIVO, no asesoramiento legal. Cada guía remite a la fuente
 * OFICIAL (sourceUrl). `reviewed: false` hasta que una persona valide los pasos
 * contra el organismo (mismo criterio que las fichas de conocimiento). Los
 * trámites y requisitos pueden variar por provincia y actualizarse.
 */

export type TramiteRequirementSeed = { label: string; detail?: string };
export type TramiteStepSeed = { title: string; detail: string; where?: string };

export type TramiteGuideSeed = {
  slug: string;
  title: string;
  summary: string;
  category: string; // cud | pension | transporte | escolaridad | salud
  estimatedTime?: string;
  requirements: TramiteRequirementSeed[];
  steps: TramiteStepSeed[];
  source?: string;
  sourceUrl?: string;
};

export const TRAMITE_GUIDES: TramiteGuideSeed[] = [
  {
    slug: "cud",
    title: "Certificado Único de Discapacidad (CUD)",
    summary:
      "Documento público y gratuito que acredita la discapacidad. Es la llave para acceder a prestaciones: cobertura del 100% (Ley 24.901), transporte gratuito, asignaciones y más.",
    category: "cud",
    estimatedTime: "Variable por provincia (semanas a meses)",
    source: "ANDIS — Agencia Nacional de Discapacidad",
    sourceUrl: "https://www.argentina.gob.ar/andis/certificado-unico-de-discapacidad",
    requirements: [
      { label: "DNI del titular (y del tutor/a si es menor)" },
      {
        label: "Certificado médico oficial del diagnóstico",
        detail: "En el formulario que pide la Junta Evaluadora de tu provincia, firmado por el/la profesional tratante.",
      },
      {
        label: "Estudios e informes que respalden el diagnóstico",
        detail: "Estudios, informes de terapias (fonoaudiología, TO, psicología), epicrisis, etc.",
      },
      { label: "Historia clínica o resumen actualizado" },
    ],
    steps: [
      {
        title: "Reuní la documentación médica",
        detail:
          "Juntá el certificado médico en el formulario oficial y todos los estudios/informes que respalden el diagnóstico. Cuanto más completo, mejor.",
      },
      {
        title: "Pedí turno en la Junta Evaluadora",
        detail:
          "Cada provincia tiene su Junta Evaluadora Interdisciplinaria. El turno suele sacarse online o por teléfono.",
        where: "Junta Evaluadora de tu provincia (ver «Cerca tuyo» o el sitio de ANDIS).",
      },
      {
        title: "Asistí a la evaluación",
        detail:
          "Un equipo interdisciplinario evalúa la documentación y a la persona. Llevá todo el original y copias.",
      },
      {
        title: "Esperá la resolución",
        detail:
          "La Junta resuelve si corresponde el CUD, para qué diagnóstico y con qué orientaciones (transporte, cobertura).",
      },
      {
        title: "Retirá el CUD",
        detail:
          "Te avisan cómo y dónde retirarlo (o queda disponible en formato digital vía Mi Argentina).",
        where: "App/sitio Mi Argentina o el lugar que indique la Junta.",
      },
      {
        title: "Usá el CUD para acceder a prestaciones",
        detail:
          "Con el CUD podés tramitar transporte gratuito, cobertura del 100% con tu obra social/prepaga y otras prestaciones.",
      },
    ],
  },
  {
    slug: "pension-invalidez",
    title: "Pensión No Contributiva por Invalidez",
    summary:
      "Prestación mensual para personas con un porcentaje de discapacidad que no cuentan con otra cobertura ni recursos suficientes. Incluye cobertura de salud.",
    category: "pension",
    estimatedTime: "Variable (meses)",
    source: "ANDIS",
    sourceUrl: "https://www.argentina.gob.ar/andis/pensiones-no-contributivas-por-invalidez-laboral",
    requirements: [
      { label: "DNI del titular" },
      { label: "Certificado Médico Oficial (CMO)", detail: "Acredita ≥ 66% de disminución en la capacidad laboral." },
      { label: "Documentación socioeconómica del grupo familiar" },
    ],
    steps: [
      {
        title: "Verificá que cumplís los requisitos",
        detail:
          "Se evalúa el grado de discapacidad y la situación socioeconómica (que no haya otra cobertura ni ingresos suficientes).",
      },
      {
        title: "Reuní el Certificado Médico Oficial y la documentación",
        detail: "El CMO lo completa un/a profesional; sumá la documentación del grupo familiar.",
      },
      {
        title: "Iniciá el trámite en ANDIS / la agencia local",
        detail: "Presentá la solicitud y la documentación por el canal que indique ANDIS.",
        where: "ANDIS o su delegación provincial.",
      },
      {
        title: "Seguí el estado de la solicitud",
        detail: "El organismo evalúa y notifica la resolución. Puede pedir documentación adicional.",
      },
    ],
  },
  {
    slug: "transporte-gratuito",
    title: "Transporte público gratuito",
    summary:
      "Con el CUD, la persona con discapacidad (y un acompañante si el certificado lo indica) viaja gratis en transporte público de colectivos, trenes y micros de larga distancia.",
    category: "transporte",
    estimatedTime: "Inmediato con el CUD vigente",
    source: "Ministerio de Transporte / ANDIS",
    sourceUrl: "https://www.argentina.gob.ar/andis/certificado-unico-de-discapacidad",
    requirements: [
      { label: "CUD vigente" },
      { label: "DNI" },
    ],
    steps: [
      {
        title: "Tené el CUD vigente",
        detail: "Es el requisito central. Si dice «con acompañante», el acompañante también viaja gratis.",
      },
      {
        title: "Para corta/media distancia (colectivo, tren)",
        detail:
          "Presentá el CUD y el DNI al viajar. Según la jurisdicción puede tramitarse una credencial o pase.",
      },
      {
        title: "Para larga distancia (micro)",
        detail:
          "Reservá el pasaje con anticipación presentando el CUD; la empresa asigna los pasajes gratuitos por ley.",
        where: "Boleterías o canales de las empresas de larga distancia.",
      },
    ],
  },
  {
    slug: "apoyos-escolares",
    title: "Apoyos e inclusión escolar",
    summary:
      "Derecho a la inclusión educativa con apoyos: maestra/o de apoyo a la inclusión (MAI), adecuaciones curriculares y proyecto pedagógico individual, con cobertura de la obra social.",
    category: "escolaridad",
    estimatedTime: "Coordinado con la escuela y la obra social",
    source: "Ley 26.206 / Ley 24.901",
    sourceUrl: "https://www.argentina.gob.ar/educacion/aprender/educacion-inclusiva",
    requirements: [
      { label: "CUD (para la cobertura de los apoyos por la obra social)" },
      { label: "Informes de la escuela y de los profesionales tratantes" },
    ],
    steps: [
      {
        title: "Hablá con la escuela y el equipo de orientación",
        detail:
          "Planteá la necesidad de apoyos. El equipo de orientación escolar (EOE) es el interlocutor.",
        where: "Equipo de orientación de la escuela.",
      },
      {
        title: "Gestioná el/la maestro/a de apoyo (MAI)",
        detail:
          "Con el CUD, la obra social/prepaga cubre el/la MAI. Suele intervenir un servicio de inclusión.",
      },
      {
        title: "Acordá el proyecto pedagógico y las adecuaciones",
        detail:
          "Se define por escrito un proyecto individual con adecuaciones curriculares según las necesidades.",
      },
    ],
  },
];
