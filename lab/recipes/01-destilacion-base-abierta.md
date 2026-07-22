# Receta 01 — Destilación sobre base abierta (Etapa 2)

Convierte una base sub-1B en un chat empático rioplatense imitando al profesor comercial, con on-policy distillation. Prerequisitos: harness de eval corriendo (Etapa 0) y dataset sintético v1 (Etapa 1).

## Hardware y costo

- Iteración: RTX 3060 12GB local — full fine-tune de ≤1B con `paged_adamw_8bit` + gradient checkpointing + bf16 + batch chico con gradient accumulation. **Primer paso obligatorio: benchmark propio de 100–500 steps para medir horas/época real** (no está documentado en ninguna fuente; no planificar calendario sin este número).
- Corridas grandes / profesor pesado: RunPod/Vast spot (A100 80GB ~USD 1.4–2/h; 4090 Community ~USD 0.34/h). Una corrida completa de destilación: ~USD 5–20.

## Pasos

1. **Bake-off de bases** (una vez): SFT corto idéntico (mismo dataset chico, mismos steps) sobre Qwen3-0.6B, SmolLM2-360M, Granite 4.0 Nano 350M (+ LFM2-350M si la licencia cierra para MaatWork) → harness capas 1–4 → elegir UNA base. Registrar todo en trackio.
2. **SFT curricular** (recipe openPangu-1B, arXiv 2509.26497): primero ejemplos con razonamiento/contexto explícito de por qué se responde así, después pares directos sin scaffolding (ratio ~3:1), para no pagar latencia en producción. **Safety mix en cada batch.**
3. **Destilación on-policy** con TRL:
   - `trl.experimental.distillation.DistillationTrainer`, profesor en **teacher server** vLLM externo (spot o el endpoint comercial si sus términos lo permiten) — no compite por VRAM local.
   - `lmbda` progresivo: 0.5 (mixto) → 1.0 (full on-policy, solo prompts — el estudiante genera sus propias completions y el profesor puntúa cada token).
   - Hiperparámetros de partida (paper openPangu): peso KD λ=0.9, top-k=10, `beta` hacia KL inversa.
4. **QAT** ~5k pasos finales target int4 (embedding int8) → export GGUF `Q4_K_M` (default) + `Q8_0` (server) + ONNX para transformers.js.
5. **Gate completo** ([`../eval/README.md`](../eval/README.md)) — capas 1–8. Solo un checkpoint verde se sube a `maatwork-lab` con tag `promoted`.

## Servir detrás del router (los 6 supuestos ocultos del swap)

Al apuntar `simon/` al endpoint propio (llama.cpp server / vLLM, OpenAI-compatible):

1. `AI_API_KEY` con valor dummy no vacío (vacía = la app cree que no hay IA).
2. `AI_EXTRA_BODY` **vacío** (el hack `thinking:disabled` del gateway actual da 400 en servers propios).
3. `AI_GENERATION_TIMEOUT_MS` ajustado al hardware propio; **`LLM_TIMEOUT_MS=8s` de `moderation.ts:104` está hardcodeado** — pasarlo a env si el modelo propio modera (backlog).
4. Re-tunear `CONTEXT_BUDGETS` (`context-budget.ts`) al tokenizer real (~3 chars/token en español, ventana del modelo propio).
5. Configurar `AI_PROVIDERS`/`AI_FALLBACK_*` con el comercial de fallback y **activar `resolveProvider` en los call sites** (hoy duerme — cambio de código chico en `generate.ts`/`memory.ts`/`moderation.ts`).
6. Decidir el moderador de capa 2: mantener `OPENAI_API_KEY` real (gratis) o apuntar `AI_SMALL_MODEL` a un modelo más fuerte que el generador.

Después: **shadow mode** (generar en paralelo sin servir, comparar con harness) → A/B solo en turnos de bajo riesgo clasificados por maat-guard, con fallback automático (= plan v1 etapa 4).
