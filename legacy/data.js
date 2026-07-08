// Datos de ejemplo para la maqueta. NO es contenido validado.
// En el producto real, cada ficha lleva revisión de un profesional que la firma.

const CATEGORIES = [
  { id: "todas", label: "Todas" },
  { id: "neuro", label: "Neurodesarrollo", color: "#7a6cd6" },
  { id: "intel", label: "Intelectual", color: "#1d9e75" },
  { id: "motora", label: "Motora", color: "#d85a30" },
  { id: "sensorial", label: "Sensorial", color: "#c94f79" },
  { id: "pocofrec", label: "Poco frecuentes", color: "#b8791a" },
];

const CONDITIONS = [
  {
    id: "tea", nombre: "Autismo (TEA)", cat: "neuro",
    que: "Condición del neurodesarrollo que influye en la comunicación, la interacción social y la forma de procesar el entorno. No se mide de \"leve a grave\": se describe por niveles de apoyo requerido (1, 2 y 3).",
    apoyos: "Terapia del lenguaje, terapia ocupacional, acompañante externo, apoyo a la integración escolar.",
    derechos: "CUD, cobertura del 100% de las prestaciones (Ley 24.901), integración escolar, transporte.",
  },
  {
    id: "tdah", nombre: "TDAH", cat: "neuro",
    que: "Afecta la atención, el control de impulsos y la autorregulación. Con apoyos adecuados, el impacto escolar y social se reduce muchísimo.",
    apoyos: "Tratamiento psicológico, psicopedagogía, adecuaciones escolares.",
    derechos: "Según la evaluación puede corresponder CUD; adecuaciones curriculares en la escuela.",
  },
  {
    id: "tel", nombre: "Trastornos del lenguaje (TEL)", cat: "neuro",
    que: "Dificultades persistentes para comprender o producir lenguaje, que no se explican por pérdida auditiva ni otra condición.",
    apoyos: "Fonoaudiología, psicopedagogía, apoyo escolar.",
    derechos: "Cobertura de fonoaudiología por obra social; CUD según evaluación.",
  },
  {
    id: "di", nombre: "Discapacidad intelectual", cat: "intel",
    que: "Limitaciones significativas en el funcionamiento intelectual y en las habilidades adaptativas, que se manifiestan durante el desarrollo.",
    apoyos: "Educación con apoyos o educación especial, terapia ocupacional, apoyo a la vida diaria.",
    derechos: "CUD, Ley 24.901, pensión no contributiva según el caso.",
  },
  {
    id: "down", nombre: "Síndrome de Down", cat: "intel",
    que: "Alteración genética por una copia extra del cromosoma 21. Cada persona tiene un perfil único de fortalezas y necesidades.",
    apoyos: "Estimulación temprana, fonoaudiología, controles médicos específicos.",
    derechos: "CUD, cobertura integral de prestaciones y salud.",
  },
  {
    id: "xfragil", nombre: "Síndrome X frágil", cat: "intel",
    que: "La causa hereditaria más frecuente de discapacidad intelectual, ligada al cromosoma X. Puede asociarse a rasgos del espectro autista.",
    apoyos: "Estimulación temprana, terapia del lenguaje, apoyo conductual.",
    derechos: "CUD, Ley 24.901, régimen de enfermedades poco frecuentes.",
  },
  {
    id: "pc", nombre: "Parálisis cerebral", cat: "motora",
    que: "Grupo de trastornos del movimiento y la postura causados por una lesión en el cerebro en desarrollo. Su expresión varía muchísimo entre personas.",
    apoyos: "Kinesiología, terapia ocupacional, equipamiento (sillas posturales, bipedestadores), fonoaudiología.",
    derechos: "CUD, cobertura de equipamiento y rehabilitación, transporte.",
  },
  {
    id: "espina", nombre: "Espina bífida", cat: "motora",
    que: "Malformación congénita del tubo neural que puede afectar la movilidad y el control de esfínteres.",
    apoyos: "Kinesiología, urología especializada, equipamiento ortopédico.",
    derechos: "CUD, cobertura integral, insumos (sondas, descartables).",
  },
  {
    id: "distrofia", nombre: "Distrofias musculares", cat: "motora",
    que: "Enfermedades genéticas progresivas que debilitan los músculos, como la distrofia de Duchenne.",
    apoyos: "Kinesiología motora y respiratoria, equipamiento, seguimiento neurológico.",
    derechos: "CUD, régimen de poco frecuentes, cobertura de medicación específica.",
  },
  {
    id: "visual", nombre: "Discapacidad visual", cat: "sensorial",
    que: "Abarca desde baja visión hasta ceguera. Impacta la autonomía y el acceso a la información, con enormes diferencias según los apoyos disponibles.",
    apoyos: "Estimulación visual, orientación y movilidad, braille y tecnología asistiva.",
    derechos: "CUD, educación inclusiva, materiales accesibles.",
  },
  {
    id: "auditiva", nombre: "Discapacidad auditiva", cat: "sensorial",
    que: "Pérdida auditiva parcial o total, congénita o adquirida. La detección temprana cambia el pronóstico del lenguaje.",
    apoyos: "Audífonos o implante coclear, fonoaudiología, lengua de señas argentina (LSA).",
    derechos: "CUD, cobertura de audífonos e implantes, intérprete en trámites.",
  },
  {
    id: "sordoceguera", nombre: "Sordoceguera", cat: "sensorial",
    que: "Combinación de pérdida visual y auditiva que requiere formas propias de comunicación y acompañamiento.",
    apoyos: "Comunicación táctil, mediadores, tecnología asistiva.",
    derechos: "CUD, apoyos específicos de comunicación.",
  },
  {
    id: "dup15q", nombre: "Duplicación 15q", cat: "pocofrec",
    que: "Síndrome genético por duplicación de una región del cromosoma 15. Se asocia a hipotonía, retrasos del desarrollo, epilepsia y rasgos del espectro autista.",
    apoyos: "Estimulación temprana, seguimiento neurológico (epilepsia), terapias múltiples coordinadas.",
    derechos: "CUD, régimen de enfermedades poco frecuentes (Ley 26.689), Ley 24.901.",
  },
  {
    id: "rett", nombre: "Síndrome de Rett", cat: "pocofrec",
    que: "Trastorno genético que afecta casi exclusivamente a niñas: tras un desarrollo inicial típico, aparece una regresión en el lenguaje y el uso de las manos.",
    apoyos: "Kinesiología, comunicación aumentativa y alternativa, seguimiento neurológico.",
    derechos: "CUD, régimen de poco frecuentes, cobertura integral.",
  },
  {
    id: "pw", nombre: "Síndrome de Prader-Willi", cat: "pocofrec",
    que: "Síndrome genético con hipotonía en la primera infancia y luego un apetito insaciable que requiere manejo estricto del entorno alimentario.",
    apoyos: "Endocrinología, nutrición, terapia ocupacional, apoyo conductual.",
    derechos: "CUD, régimen de poco frecuentes, hormona de crecimiento según indicación.",
  },
];

// Respuestas guionadas del chat (maqueta, sin IA).
const CHAT_SCRIPTS = {
  diagnostico: {
    pregunta: "Mi hijo acaba de recibir un diagnóstico, ¿por dónde empiezo?",
    respuesta: "Lo primero: respirá, no tenés que resolver todo hoy. El recorrido tiene un orden y te lo voy a ir marcando paso a paso.<br><br>El primer paso concreto es tramitar el <strong>CUD (Certificado Único de Discapacidad)</strong>. Es gratuito y es la llave que habilita casi todos los derechos: prestaciones, terapias, transporte y asignaciones.<br><br>Armé tu recorrido completo en la sección <strong>Mi ruta</strong>. ¿Querés que lo veamos?",
    fuente: "Ley 22.431 · Ley 24.901 · ANDIS",
    cta: { label: "Ver Mi ruta", view: "ruta" },
  },
  cud: {
    pregunta: "¿Cómo tramito el CUD?",
    respuesta: "El CUD se solicita ante la <strong>Junta Evaluadora</strong> de tu provincia. En líneas generales necesitás:<br><br>• DNI de la persona<br>• Resumen de historia clínica del médico tratante<br>• Estudios que respalden el diagnóstico<br><br>Se pide turno, la junta evalúa y emite el certificado. Es <strong>gratuito</strong> y tiene fecha de vencimiento, así que conviene anotar cuándo renovarlo.",
    fuente: "Ley 22.431, art. 3 · ANDIS — Certificado Único de Discapacidad",
    cta: null,
  },
  obrasocial: {
    pregunta: "La obra social me rechazó una prestación",
    respuesta: "Tenés derecho a reclamar. Con CUD, la obra social debe cubrir el <strong>100%</strong> de las prestaciones de discapacidad (Ley 24.901); un rechazo casi siempre es apelable.<br><br>El primer paso es pedir el <strong>rechazo por escrito</strong> y presentar una nota de reclamo formal. En el producto real vas a poder descargar acá un modelo de nota listo para completar.<br><br>Importante: no puedo darte asesoramiento legal específico para tu caso. Si el reclamo no avanza, conviene consultar con un abogado especializado.",
    fuente: "Ley 24.901 · Superintendencia de Servicios de Salud",
    cta: null,
  },
};
