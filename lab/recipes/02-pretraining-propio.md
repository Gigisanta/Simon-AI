# Receta 02 — Tokenizer rioplatense + pretraining maat-micro (Etapa 3)

La innovación de fondo: primer tokenizer español-AR y primer modelo conversacional español-first sub-500M. Condicional: la Etapa 2 (destilado) ya funciona y es el fallback si esto no supera su gate.

## 1. Tokenizer propio (publicable por sí solo)

1. Corpus de entrenamiento del tokenizer: FineWeb2-es filtrado a dominios .ar/.uy + dataset sintético rioplatense propio + ~10% inglés/código (robustez).
2. Entrenar BPE/SentencePiece 32k (nano) y 49k (micro/mini) — vocab chico a propósito: a esta escala el embedding domina los parámetros (`Scaling Laws with Vocabulary`, NeurIPS 2024).
3. **Medir fertilidad** (tokens/palabra) en texto argentino real vs tokenizers de Qwen3, Gemma 3, Salamandra y GPT-4 — el resultado es el paper/post técnico. Objetivo: fertilidad menor en rioplatense (voseo, diminutivos, lunfardo) sin degradar es-neutro.

## 2. Toy run local (validación de pipeline, RTX 3060)

- litgpt (`debug.yaml` estilo Pythia-14M) o nanochat con `--depth` mínimo: 10–50M params, unos cientos de millones de tokens es-AR.
- Valida: pipeline de datos (datatrove o scripts propios), tokenizer, config, loss curve sana, checkpoints/resume, trackio.
- Expectativa honesta: días de wall-clock. Es validación, no producto.

## 3. Pretraining maat-micro (cloud spot)

- Base: fork de nanochat (MIT) adaptado a: tokenizer propio, config [`../configs/maat-micro.yaml`](../configs/maat-micro.yaml) (sliding-window 5:1, GQA 4:1, QK-norm, sink token, tying), datos es-first.
- Mezcla de datos (currículum estilo SmolLM2, por fases): FineWeb2-es filtrado → + sintético conversacional → + calidad alta al final (annealing). 100B–400B tokens según presupuesto.
- Hardware: nodo 8xH100 spot (~USD 12–24/h). Orden de magnitud: decenas a pocas centenas de horas-nodo → **USD 1.500–4.000**. Checkpoints cada N steps a B2; resume ante preemption de spot (spot se corta — el pipeline DEBE reanudar).
- QAT int4 al final (~5k pasos).

## 4. Post-training y decisión

- Aplicar la Receta 01 completa sobre el checkpoint propio (SFT curricular + destilación + gate).
- **Decisión por gate, no por orgullo**: si maat-micro propio < base abierta destilada en el harness → la Etapa 2 sigue siendo el producto; quedan el tokenizer, el pipeline y el know-how como activos. Reintentar con más tokens/datos mejores es una decisión de presupuesto explícita, no un default.

## Registro

Todo en trackio + HF Hub (`maatwork-lab/maat-micro`, branches por experimento, tag `promoted` solo con gate verde). Dataset cards con hash y git SHA. Los números de costo/duración REALES de cada corrida se anotan acá abajo al ejecutarla:

| Fecha | Corrida | Hardware | Duración | Costo real | Resultado |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
