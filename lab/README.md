# lab/ — Laboratorio MaatWork de modelos propios

Sistema de entrenamiento, evaluación y despliegue de la familia **Maat** (modelos conversacionales ultra-pequeños en español rioplatense para Simón). Plan completo: [`docs/plan-lab-maatwork-2026-07.md`](../docs/plan-lab-maatwork-2026-07.md) · Evidencia: [`docs/research-modelo-propio-2026-07.md`](../docs/research-modelo-propio-2026-07.md).

**Estado: Etapa 0 (fundaciones).** Este directorio versiona el código, las configs y las decisiones del lab. Los pesos y datasets NO viven acá: van a la org privada de HF Hub (`maatwork-lab`) con backup frío en Backblaze B2.

## Mapa

```
lab/
  AUTOLOOP.md  Workflow de automejora: tick de 7 estados, niveles L0-L4, candados humanos
  configs/     Arquitecturas de la familia Maat (YAML declarativo, fuente de verdad)
  data/        Data engine: fuentes, licencias, pipeline sintético, curación, compliance
  eval/        Harness de evaluación y gates por checkpoint
  recipes/     Recetas ejecutables por etapa (00-bootstrap = qué falta para el primer tick)
```

## Principios (no negociables)

1. **Gate binario por checkpoint**: ningún checkpoint se promueve sin pasar el harness completo ([`eval/README.md`](eval/README.md)). La suite de crisis es bloqueante dura. Writer ≠ checker.
2. **Safety data mixing en cada batch** de fine-tuning — el fine-tuning degrada el alignment incluso con datos benignos (evidencia replicada); se mitiga por proceso, no por esperanza.
3. **Cero datos reales de menores** hasta que exista `Guardian.trainingConsentAt` (gap G3) — y aún entonces, el dataset sintético es la vía principal.
4. **Reproducibilidad**: todo run = config YAML + seed + git SHA + dataset card con hash. Tracking con trackio (local-first).
5. **El modelo propio nunca es la última red de un turno de riesgo**: crisis → plantilla determinística + maat-guard + derivación. El dataset generativo excluye crisis por diseño.
6. **Local para iterar, spot para entrenar**: la RTX 3060 12GB corre toys, el guard, cuantizaciones y evals; pretraining y destilaciones grandes van a RunPod/Vast spot. No se compra GPU hasta que el gasto real lo justifique.

## Stack (decidido por research, jul 2026)

| Función | Herramienta | Por qué |
|---|---|---|
| Post-training / destilación | **TRL** (`DistillationTrainer` con teacher-server) + Unsloth para VRAM | On-policy distillation nativa; el profesor no compite por VRAM local |
| Pretraining chico | fork de **nanochat** (MIT) / litgpt para toys | Pipeline completo hackeable, ~USD 15–50 por corrida speedrun en 8xH100 spot |
| Eval | **lm-eval-harness** (SpanishBench) + harness propio | Ver [`eval/README.md`](eval/README.md) |
| Tracking | **trackio** (HF) | Gratis, local-first, API compatible wandb |
| Registro | HF Hub PRO org `maatwork-lab` | USD 9/mes, 1TB privado |
| Backup frío | Backblaze B2 | ~USD 6/TB/mes |
| Cuantización | QAT integrado (int4) + HQQ para iterar + GGUF Q4_K_M/Q8_0 | Receta Gemma 3 QAT; HQQ no necesita calibración |
| Runtime browser | transformers.js v3 (ONNX, WebGPU+WASM) | Conversión simple, fallback en la misma librería |
| Runtime móvil nativo (futuro) | ExecuTorch | MediaPipe está en mantenimiento |
| Serving server | llama.cpp server / vLLM, endpoint OpenAI-compatible | Entra por `resolveProvider` (ADR-3) con fallback comercial |
