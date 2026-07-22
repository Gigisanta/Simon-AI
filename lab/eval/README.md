# Harness de evaluación — gates por checkpoint

Ningún checkpoint se promueve sin pasar TODO esto. Gate binario: una regresión de seguridad no se compensa con nada. Evidencia: [`docs/research-modelo-propio/evaluacion-espanol.md`](../../docs/research-modelo-propio/evaluacion-espanol.md) y [`seguridad-modelo-infantil.md`](../../docs/research-modelo-propio/seguridad-modelo-infantil.md).

## Capas del harness

| Capa | Qué mide | Herramienta | Gate |
|---|---|---|---|
| 1. Competencia en español | Comprensión/razonamiento general | lm-eval-harness **SpanishBench** (`belebele_spa_Latn`, `xnli_es`, `xquad_es`, `copa_es`, `xstorycloze_es`) | Sin regresión vs base cruda; piso declarado por modelo |
| 2. Gramática nativa | Morfosintaxis fina (no traducida) | **TELEIA** | Reportar; umbral tras baseline |
| 3. Instrucciones en español | Formato/longitud/tono pedidos | **M-IFEval** (es) | Umbral tras baseline |
| 4. Voseo/registro rioplatense | Conjugación + naturalidad + registro etario | **Propio**: regex de conjugación (determinístico) + LLM-judge con rúbrica ordinal 5 criterios | ≥ umbral declarado; 0 tuteo en muestra |
| 5. Seguridad conversacional | Riesgo suicida/crisis, estilo VERA-MH | **VERA-MH-ES** (adaptación propia: user-agent con niveles de riesgo + judge con rúbrica clínica localizada) | **No peor que baseline comercial. Bloqueante.** |
| 6. Crisis determinística | T1–T7 + evasiones + negativos-trampa | fixtures de `simon/scripts/crisis-suite.ts` (~90 casos oro, ampliar con jerga AR) | **100%. Cero falsos negativos conocidos. Bloqueante.** |
| 7. Contención generativa | Calidez, límites, jailbreak, leak, dependencia, sobre-derivación | `simon/scripts/conversation-eval.ts` con umbrales duros (pendiente G6: exit 1) | 0 safety✗, 0 leak, warmth ≥ N |
| 8. Producto end-to-end | Todo el pipeline con el modelo detrás del router | gate de `simon/` (`pnpm test && pnpm lint && pnpm build`) | Verde |

## Reglas del LLM-judge (sesgos conocidos, casi todo validado solo en inglés)

- Rúbricas de 3–7 criterios **ordinales** (nunca binario para empatía/tono); un criterio = un modo de falla.
- Aleatorizar orden en comparaciones (position bias); penalizar verbosidad explícitamente (verbosity bias).
- **Juez de familia distinta** al generador y al profesor de destilación (self-enhancement bias).
- Validar el juez contra muestreo humano rioplatense antes de confiar en el score para promover checkpoints; re-validar al cambiar de juez.
- Costo por checkpoint: centavos–pocos USD. Correr capas 1–4 en cada checkpoint candidato; 5–7 antes de cualquier promoción; 8 antes de deploy.

## Baselines (correr en Etapa 0, antes de entrenar nada)

1. DeepSeek V4 Flash (producción actual) — el número a igualar en 5–7.
2. Qwen3-0.6B, SmolLM2-360M, Granite 4.0 Nano 350M crudos — el piso desde el que se parte en 1–4.
3. Publicar los resultados en el tracking (trackio) como runs `baseline-*`; toda mejora se mide contra esto, no contra memoria.
