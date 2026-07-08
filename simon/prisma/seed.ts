// Seed de la base de conocimiento (RAG liviano).
// Portado desde legacy/data.js — contenido de maqueta, NO validado.
// `reviewed: false` hasta que un profesional firme cada ficha.
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});
const prisma = new PrismaClient({ adapter });

type Card = {
  slug: string;
  category: string;
  title: string;
  body: string;
  source?: string;
};

const CONDITIONS: Card[] = [
  {
    slug: "tea",
    category: "neuro",
    title: "Autismo (TEA)",
    body: `Qué es: Condición del neurodesarrollo que influye en la comunicación, la interacción social y la forma de procesar el entorno. No se mide de "leve a grave": se describe por niveles de apoyo requerido (1, 2 y 3).
Apoyos frecuentes: Terapia del lenguaje, terapia ocupacional, acompañante externo, apoyo a la integración escolar.
Derechos: CUD, cobertura del 100% de las prestaciones (Ley 24.901), integración escolar, transporte.`,
    source: "Ley 24.901",
  },
  {
    slug: "tdah",
    category: "neuro",
    title: "TDAH",
    body: `Qué es: Afecta la atención, el control de impulsos y la autorregulación. Con apoyos adecuados, el impacto escolar y social se reduce muchísimo.
Apoyos frecuentes: Tratamiento psicológico, psicopedagogía, adecuaciones escolares.
Derechos: Según la evaluación puede corresponder CUD; adecuaciones curriculares en la escuela.`,
  },
  {
    slug: "tel",
    category: "neuro",
    title: "Trastornos del lenguaje (TEL)",
    body: `Qué es: Dificultades persistentes para comprender o producir lenguaje, que no se explican por pérdida auditiva ni otra condición.
Apoyos frecuentes: Fonoaudiología, psicopedagogía, apoyo escolar.
Derechos: Cobertura de fonoaudiología por obra social; CUD según evaluación.`,
  },
  {
    slug: "di",
    category: "intel",
    title: "Discapacidad intelectual",
    body: `Qué es: Limitaciones significativas en el funcionamiento intelectual y en las habilidades adaptativas, que se manifiestan durante el desarrollo.
Apoyos frecuentes: Educación con apoyos o educación especial, terapia ocupacional, apoyo a la vida diaria.
Derechos: CUD, Ley 24.901, pensión no contributiva según el caso.`,
    source: "Ley 24.901",
  },
  {
    slug: "down",
    category: "intel",
    title: "Síndrome de Down",
    body: `Qué es: Alteración genética por una copia extra del cromosoma 21. Cada persona tiene un perfil único de fortalezas y necesidades.
Apoyos frecuentes: Estimulación temprana, fonoaudiología, controles médicos específicos.
Derechos: CUD, cobertura integral de prestaciones y salud.`,
  },
  {
    slug: "xfragil",
    category: "intel",
    title: "Síndrome X frágil",
    body: `Qué es: La causa hereditaria más frecuente de discapacidad intelectual, ligada al cromosoma X. Puede asociarse a rasgos del espectro autista.
Apoyos frecuentes: Estimulación temprana, terapia del lenguaje, apoyo conductual.
Derechos: CUD, Ley 24.901, régimen de enfermedades poco frecuentes.`,
    source: "Ley 24.901 · Ley 26.689",
  },
  {
    slug: "pc",
    category: "motora",
    title: "Parálisis cerebral",
    body: `Qué es: Grupo de trastornos del movimiento y la postura causados por una lesión en el cerebro en desarrollo. Su expresión varía muchísimo entre personas.
Apoyos frecuentes: Kinesiología, terapia ocupacional, equipamiento (sillas posturales, bipedestadores), fonoaudiología.
Derechos: CUD, cobertura de equipamiento y rehabilitación, transporte.`,
  },
  {
    slug: "espina",
    category: "motora",
    title: "Espina bífida",
    body: `Qué es: Malformación congénita del tubo neural que puede afectar la movilidad y el control de esfínteres.
Apoyos frecuentes: Kinesiología, urología especializada, equipamiento ortopédico.
Derechos: CUD, cobertura integral, insumos (sondas, descartables).`,
  },
  {
    slug: "distrofia",
    category: "motora",
    title: "Distrofias musculares",
    body: `Qué es: Enfermedades genéticas progresivas que debilitan los músculos, como la distrofia de Duchenne.
Apoyos frecuentes: Kinesiología motora y respiratoria, equipamiento, seguimiento neurológico.
Derechos: CUD, régimen de poco frecuentes, cobertura de medicación específica.`,
    source: "Ley 26.689",
  },
  {
    slug: "visual",
    category: "sensorial",
    title: "Discapacidad visual",
    body: `Qué es: Abarca desde baja visión hasta ceguera. Impacta la autonomía y el acceso a la información, con enormes diferencias según los apoyos disponibles.
Apoyos frecuentes: Estimulación visual, orientación y movilidad, braille y tecnología asistiva.
Derechos: CUD, educación inclusiva, materiales accesibles.`,
  },
  {
    slug: "auditiva",
    category: "sensorial",
    title: "Discapacidad auditiva",
    body: `Qué es: Pérdida auditiva parcial o total, congénita o adquirida. La detección temprana cambia el pronóstico del lenguaje.
Apoyos frecuentes: Audífonos o implante coclear, fonoaudiología, lengua de señas argentina (LSA).
Derechos: CUD, cobertura de audífonos e implantes, intérprete en trámites.`,
  },
  {
    slug: "sordoceguera",
    category: "sensorial",
    title: "Sordoceguera",
    body: `Qué es: Combinación de pérdida visual y auditiva que requiere formas propias de comunicación y acompañamiento.
Apoyos frecuentes: Comunicación táctil, mediadores, tecnología asistiva.
Derechos: CUD, apoyos específicos de comunicación.`,
  },
  {
    slug: "dup15q",
    category: "pocofrec",
    title: "Duplicación 15q",
    body: `Qué es: Síndrome genético por duplicación de una región del cromosoma 15. Se asocia a hipotonía, retrasos del desarrollo, epilepsia y rasgos del espectro autista.
Apoyos frecuentes: Estimulación temprana, seguimiento neurológico (epilepsia), terapias múltiples coordinadas.
Derechos: CUD, régimen de enfermedades poco frecuentes (Ley 26.689), Ley 24.901.`,
    source: "Ley 26.689 · Ley 24.901",
  },
  {
    slug: "rett",
    category: "pocofrec",
    title: "Síndrome de Rett",
    body: `Qué es: Trastorno genético que afecta casi exclusivamente a niñas: tras un desarrollo inicial típico, aparece una regresión en el lenguaje y el uso de las manos.
Apoyos frecuentes: Kinesiología, comunicación aumentativa y alternativa, seguimiento neurológico.
Derechos: CUD, régimen de poco frecuentes, cobertura integral.`,
    source: "Ley 26.689",
  },
  {
    slug: "pw",
    category: "pocofrec",
    title: "Síndrome de Prader-Willi",
    body: `Qué es: Síndrome genético con hipotonía en la primera infancia y luego un apetito insaciable que requiere manejo estricto del entorno alimentario.
Apoyos frecuentes: Endocrinología, nutrición, terapia ocupacional, apoyo conductual.
Derechos: CUD, régimen de poco frecuentes, hormona de crecimiento según indicación.`,
    source: "Ley 26.689",
  },
];

const TRAMITES: Card[] = [
  {
    slug: "primeros-pasos-diagnostico",
    category: "tramites",
    title: "Primeros pasos tras un diagnóstico",
    body: `Lo primero: no hay que resolver todo hoy; el recorrido tiene un orden.
El primer paso concreto es tramitar el CUD (Certificado Único de Discapacidad). Es gratuito y es la llave que habilita casi todos los derechos: prestaciones, terapias, transporte y asignaciones.`,
    source: "Ley 22.431 · Ley 24.901 · ANDIS",
  },
  {
    slug: "como-tramitar-cud",
    category: "tramites",
    title: "Cómo tramitar el CUD",
    body: `El CUD se solicita ante la Junta Evaluadora de cada provincia. En líneas generales se necesita:
- DNI de la persona
- Resumen de historia clínica del médico tratante
- Estudios que respalden el diagnóstico
Se pide turno, la junta evalúa y emite el certificado. Es gratuito y tiene fecha de vencimiento: conviene anotar cuándo renovarlo.`,
    source: "Ley 22.431, art. 3 · ANDIS — Certificado Único de Discapacidad",
  },
  {
    slug: "rechazo-obra-social",
    category: "tramites",
    title: "Qué hacer si la obra social rechaza una prestación",
    body: `Con CUD, la obra social debe cubrir el 100% de las prestaciones de discapacidad (Ley 24.901); un rechazo casi siempre es apelable.
Primer paso: pedir el rechazo por escrito y presentar una nota de reclamo formal.
Importante: esto es información general, no asesoramiento legal para un caso puntual. Si el reclamo no avanza, conviene consultar con un abogado especializado o la Superintendencia de Servicios de Salud.`,
    source: "Ley 24.901 · Superintendencia de Servicios de Salud",
  },
];

async function main() {
  const cards = [...CONDITIONS, ...TRAMITES];
  for (const card of cards) {
    await prisma.knowledgeCard.upsert({
      where: { slug: card.slug },
      update: {
        category: card.category,
        title: card.title,
        body: card.body,
        source: card.source ?? null,
      },
      create: {
        slug: card.slug,
        category: card.category,
        title: card.title,
        body: card.body,
        source: card.source ?? null,
        reviewed: false,
      },
    });
  }
  console.log(`Seeded ${cards.length} knowledge cards.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
