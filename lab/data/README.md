# Data engine — datasets del laboratorio

Fuentes, licencias, pipeline sintético y compliance. Evidencia: [`docs/research-modelo-propio/datasets-espanol.md`](../../docs/research-modelo-propio/datasets-espanol.md) y [`repo-data-flywheel.md`](../../docs/research-modelo-propio/repo-data-flywheel.md).

## Regla cero (legal, bloqueante)

**Cero datos reales de menores** hasta que exista `Guardian.trainingConsentAt` y el export filtre por él (gap G3, [`docs/mejoras-arquitectura-2026-07.md`](../../docs/mejoras-arquitectura-2026-07.md) P0). Y aún con G3: el sintético es la vía principal; lo real solo cura/calibra. Las categorías de crisis/abuso jamás entran al dataset generativo (eso ya lo garantiza `training-export.ts` — no reabrir ese código, consumirlo).

## Fuentes de pretraining (licencias verificadas jul 2026)

| Corpus | Licencia | Uso |
|---|---|---|
| FineWeb2 `spa_Latn` (~484B tokens — re-verificar cifra en el dataset card antes de dimensionar) | ODC-By 1.0 | Base principal; sobremuestrear dominios .ar/.uy con clasificador de dialecto |
| HPLT v2 | CC0 | Complemento |
| Corpus Salamandra/BSC | Apache 2.0 | Ancla de calidad de español |
| SmolTalk2 (subsets nuevos) | Apache 2.0 | Instrucción multilingüe; el español es chico (decenas de miles de filas) |
| UltraChat | MIT en el repo (verificado) pero generado con ChatGPT | Solo referencia de estructura; regenerar contenido propio |
| OpenHermes 2.5 | MIXTA por subset (NO es MIT limpio — verificado) | Auditar subset por subset o evitar |
| MobileLLM datos/pesos | FAIR Noncommercial | NO usar |

## Pipeline sintético (la vía principal)

1. **Personas**: set acotado de personas sintéticas — chicos/adolescentes argentinos (edad 6–18, contexto emocional, con/sin discapacidad, registro por franja etaria) × persona Simón (acompañante, límites no-terapéuticos). Sin basarse en ninguna persona real.
2. **Generación**: método Magpie/PersonaHub multi-turn con un LLM grande offline como profesor, instruido en rioplatense explícito (vos/tenés/che, sin neutro). Costo: cientos de USD por 100k–300k turnos.
3. **Mezcla de seguridad obligatoria** en cada batch: rechazos cálidos (nunca un "no" seco), derivación a adulto de confianza/Línea 102 con proporcionalidad, identidad IA — espejo de la PERSONA de producción.
4. **Curación** (en orden): filtro de voseo (heurística `tenés|querés|vos` vs `tienes|quieres|tú`) → dedup exacto + near-dup (minhash) → cascada de moderación de prod como filtro (mismo patrón que producción) → decontaminación n-gram 8–13 contra TODO el harness de eval → muestreo de revisión humana rioplatense.
5. **Dataset card por versión**: hash de contenido, git SHA del pipeline, config de filtros, conteos por tema/franja etaria, lista de fuentes. Formato JSONL chat-completions (mismo contrato que `training-export.ts`).

## Datos reales (cuando G3 exista)

`simon/scripts/export-training.ts` ya produce JSONL redactado (PII estructural) y filtrado (sin crisis, corte en primer flag). Yield estimado: ~18k–26k ejemplos/año al volumen actual. Pendiente antes de usar: filtro `trainingConsentAt`, limpieza de `DISCLOSURE_TEXT` persistido, señal de calidad (feedback 👍/👎, delta de `MoodEntry`, `responsePath`) — gaps G1/G2/G5 del backlog.

## Dataset de riesgo (para maat-guard)

Separado del generativo y con gobernanza propia (plan v1 §3.2, intacto): sintético etiquetado por diseño + set chico revisado por clínicos (partnership UNCo). Incluye exactamente lo que el generativo excluye. Los ~90 fixtures T1–T7 de `crisis-suite.ts` son el test set de oro — ampliar con jerga adolescente AR y evasiones, jamás diluir.
