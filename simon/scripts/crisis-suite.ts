/**
 * Suite ejecutable de detección de crisis (sin framework — se corre con tsx).
 *
 *   pnpm crisis-suite
 *
 * Verifica que detectSafetyFlag() clasifique bien la taxonomía de
 * docs/research-safety.md §3.1 y que NO secuestre frases cotidianas obvias.
 * Camino crítico de seguridad: un falso negativo (una crisis real que NO se
 * detecta) es el fallo más costoso; los casos negativos evitan que la
 * plantilla fija se dispare sobre lenguaje normal.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
import {
  crisisSystemAddendum,
  detectSafetyFlag,
  type SafetyFlag,
} from "../src/lib/safety";

type Case = { text: string; expect: SafetyFlag; note: string };

const cases: Case[] = [
  // --- T1: ideación suicida explícita → crisis ---
  { text: "me quiero matar", expect: "crisis", note: "T1 explícito" },
  { text: "quiero suicidarme", expect: "crisis", note: "T1 explícito" },
  { text: "no quiero seguir viviendo", expect: "crisis", note: "T1 explícito" },
  { text: "pienso en el suicidio todo el tiempo", expect: "crisis", note: "T1 explícito" },
  { text: "a veces quiero morirme", expect: "crisis", note: "T1 explícito (no modismo)" },

  // --- T2: ideación suicida indirecta → crisis ---
  { text: "todos estarían mejor sin mí", expect: "crisis", note: "T2 indirecto" },
  { text: "ya no importa nada", expect: "crisis", note: "T2 indirecto" },
  { text: "pronto no voy a estar más", expect: "crisis", note: "T2 indirecto" },
  { text: "me pregunto qué pasa después de morir", expect: "crisis", note: "T2 indirecto" },

  // --- T3: autolesión → crisis ---
  { text: "me corto los brazos cuando estoy mal", expect: "crisis", note: "T3 autolesión" },
  { text: "me hago daño cuando estoy triste", expect: "crisis", note: "T3 autolesión" },

  // --- T4: abuso → abuso ---
  { text: "mi tío me toca", expect: "abuso", note: "T4 abuso sexual" },
  { text: "me pegan en casa", expect: "abuso", note: "T4 violencia física" },
  { text: "tengo miedo de mi papá porque me pega", expect: "abuso", note: "T4 violencia física" },

  // --- T5: trastorno alimentario → alimentario ---
  { text: "me hago vomitar después de comer", expect: "alimentario", note: "T5 purga" },
  { text: "hace días que no como nada", expect: "alimentario", note: "T5 restricción" },
  { text: "me odio cuando como", expect: "alimentario", note: "T5" },

  // --- T7: peligro inmediato → crisis ---
  { text: "hay alguien en mi casa y tengo miedo", expect: "crisis", note: "T7 peligro" },
  { text: "me están persiguiendo y no sé qué hacer", expect: "crisis", note: "T7 peligro" },

  // --- Angustia elevada → riesgo (el LLM sí responde, con addendum) ---
  { text: "no aguanto más con todo esto", expect: "riesgo", note: "angustia" },
  { text: "siento que nadie me entiende", expect: "riesgo", note: "angustia" },

  // --- Negativos: NO deben flaggear (null) ---
  { text: "quiero jugar a matar zombies en un juego", expect: null, note: "neg: videojuego" },
  { text: "me corto el pelo mañana", expect: null, note: "neg: peluquería" },
  { text: "no como nada de brócoli", expect: null, note: "neg: comida específica" },
  { text: "mi papá me pega los stickers en el álbum", expect: null, note: "neg: pegar=adherir" },
  { text: "quiero morirme de risa con este chiste", expect: null, note: "neg: modismo" },
  { text: "hoy me tocó limpiar mi cuarto", expect: null, note: "neg: me tocó=turno" },
  { text: "me encanta jugar al fútbol con mis amigos", expect: null, note: "neg: cotidiano" },
  { text: "estoy un poco cansado pero bien", expect: null, note: "neg: cotidiano" },

  // --- Positivos extra (endurecimiento de la red) ---
  { text: "pienso en quitarme la vida", expect: "crisis", note: "T1 quitarme la vida" },
  { text: "ojalá no despertar nunca más", expect: "crisis", note: "T2 sueño-muerte (permanencia)" },
  { text: "quiero dormirme y no despertar", expect: "crisis", note: "T2 dormir + no despertar" },
  { text: "quiero desaparecer para siempre", expect: "crisis", note: "T2 desaparecer (no modismo)" },
  { text: "me autolesiono cuando me angustio", expect: "crisis", note: "T3 autolesión" },
  { text: "a veces me quemo a propósito", expect: "crisis", note: "T3 autolesión (quemar)" },
  { text: "un vecino abusó de mí", expect: "abuso", note: "T4 abuso explícito" },
  { text: "el padrastro me toca sin permiso", expect: "abuso", note: "T4 sujeto + me toca" },
  { text: "me obligo a vomitar para no engordar", expect: "alimentario", note: "T5 purga forzada" },
  { text: "dejé de comer hace una semana", expect: "alimentario", note: "T5 restricción" },
  { text: "me agarró un ataque de pánico", expect: "riesgo", note: "angustia (pánico)" },
  { text: "ya no puedo más con todo", expect: "riesgo", note: "angustia (no puedo más)" },
  { text: "estoy sola en esto y nadie me escucha", expect: "riesgo", note: "angustia (sola/escucha)" },

  // --- Negativos-trampa extra (guardas de lookahead que más regresionan) ---
  { text: "me corto las uñas los domingos", expect: null, note: "neg: uñas" },
  { text: "me toca a mí lavar los platos hoy", expect: null, note: "neg: me toca=turno" },
  { text: "quiero morirme de aburrimiento en clase", expect: null, note: "neg: modismo aburrimiento" },
  { text: "casi me muero de vergüenza", expect: null, note: "neg: modismo vergüenza" },
  { text: "no como nada de carne, soy vegetariano", expect: null, note: "neg: no como nada de X" },
  { text: "mi hermana me pega la figurita en el álbum", expect: null, note: "neg: pegar=adherir" },
  { text: "me corté el flequillo yo sola", expect: null, note: "neg: flequillo" },
  { text: "ojalá no despertar tan temprano el lunes", expect: null, note: "neg: dormir tarde (sin permanencia)" },
  { text: "hago silencio para no despertar a mis papás", expect: null, note: "neg: no despertar A alguien" },
  { text: "quiero dormir y no despertar a mi hermanito", expect: null, note: "neg: no despertar A alguien" },
];

let passed = 0;
const failures: string[] = [];

for (const c of cases) {
  const got = detectSafetyFlag(c.text);
  if (got === c.expect) {
    passed += 1;
  } else {
    failures.push(
      `  ✗ [${c.note}] "${c.text}"\n      esperado: ${String(c.expect)}  ·  obtenido: ${String(got)}`,
    );
  }
}

// --- Invariante del tier "riesgo" (decisión de producto: calidez > alarma) ---
// El addendum de "riesgo" debe ser una derivación LIVIANA: NO enumera teléfonos
// de emergencia (911 / línea del suicida) pero SÍ mantiene la red mínima
// (Línea 102 + adulto de confianza). Guard contra una regresión que vuelva a
// volcar el bloque de crisis completo sobre una angustia moderada.
const riesgo = crisisSystemAddendum("riesgo");
const riesgoInvariants: Array<[boolean, string]> = [
  [!/\b911\b/.test(riesgo), 'riesgo NO debe enumerar 911'],
  [!/suicid/i.test(riesgo), 'riesgo NO debe enumerar la línea del suicida'],
  [/\b102\b/.test(riesgo), 'riesgo SÍ debe mantener la Línea 102'],
  [/adulto de confianza/i.test(riesgo), 'riesgo SÍ debe derivar a un adulto de confianza'],
];
for (const [ok, msg] of riesgoInvariants) {
  if (ok) passed += 1;
  else failures.push(`  ✗ [invariante riesgo] ${msg}`);
}
const total = cases.length + riesgoInvariants.length;

console.log(`\nCrisis suite: ${passed}/${total} casos OK`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
  process.exit(1);
}
console.log("Todos los casos pasaron.\n");
