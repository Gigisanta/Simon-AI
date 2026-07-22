# Simón AI — Integración LLM: qué requiere cambiar el proveedor

> Análisis solo-lectura del repo `simon/`. Todas las rutas son absolutas o relativas a
> `/Users/prueba/HerMaatOS/repos/Simon-AI/simon/`. Referencias con `archivo:línea`.

## 0. Cómo está cableado hoy el LLM (base para todo lo demás)

Toda la inferencia pasa por **UN** proveedor `@ai-sdk/openai-compatible` construido en
`src/lib/ai/provider.ts`:

- `getProvider()` (`provider.ts:60`) → `createOpenAICompatible({ baseURL, apiKey, transformRequestBody })`.
- `chatModel()` (`provider.ts:81`) — generación principal. Único call site real:
  `src/lib/chat-pipeline/generate.ts:61` (`generateText({ model: chatModel(), ... })`).
- `smallModel()` (`provider.ts:86`) — modelo barato. Call sites reales:
  - moderador LLM (capa 2): `src/lib/moderation.ts:349` (`generateText({ model: smallModel(), ... })`).
  - memoria: `src/lib/ai/memory.ts:241` y `:421` (resúmenes y rolling summary).
- `aiConfigured()` (`provider.ts:92`) = `Boolean(process.env.AI_API_KEY)` — usado en
  `run.ts:261` para decidir el path "no-ai" y en `memory.ts:201,385`.

Variables de entorno que gobiernan el proveedor (`.env.example:23-43`):
`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_SMALL_MODEL`, `AI_EXTRA_BODY`,
`AI_GENERATION_TIMEOUT_MS`. El router multi-proveedor ADR-3 (`resolveProvider`,
`provider.ts:338`) está implementado y testeado pero **NO está activado en ningún call
site** — `chatModel()`/`smallModel()` siguen siendo el camino real (confirmado en
`provider.ts:109-127` y ARCHITECTURE.md línea 89). Es decir: hoy hay un solo proveedor y
el circuit-breaker/fallback duerme.

Diseño clave de seguridad (ARCHITECTURE.md línea 98): **no se streamea nunca**; se genera
completo → se modera la salida → se muestra. Confirmado: `respond.ts` solo emite texto ya
resuelto vía `createUIMessageStream` (un `text-delta` único, `respond.ts:39-54`), y
`run.ts:410` corre `moderate(outputText)` antes de devolver.

---

## (a) Reemplazar DeepSeek/gateway por un modelo propio en endpoint OpenAI-compatible propio

**Veredicto corto:** el *cableado* es casi env-only, pero **"cero cambio de código" es
optimista**. Hay al menos 6 supuestos ocultos que hay que tocar o re-verificar. Ninguno es
bloqueante, pero saltárselos rompe el chat o degrada la seguridad en silencio.

### Lo que SÍ es solo-env
- `AI_BASE_URL` → tu endpoint (`provider.ts:64`).
- `AI_MODEL` / `AI_SMALL_MODEL` → tus IDs (`provider.ts:77,88`).
- El SDK habla `POST /chat/completions` OpenAI-estándar. vLLM, Ollama, TGI, llama.cpp
  `--api openai` cumplen. No se usa streaming (menos superficie), ni `response_format`/JSON
  mode: el parseo es por regex de `{...}` sobre texto libre (`moderation.ts:292`,
  `memory.ts:141`) → **no dependés de que el server soporte json_schema**. Bien.
- `temperature`, `maxOutputTokens` (700 menor / 1400 tutor en `generate.ts:14-17`; 60 para
  moderación en `moderation.ts:353`; 500 para resúmenes) son params estándar.

### Supuestos ocultos que HAY que tocar/verificar

1. **`AI_API_KEY` no puede quedar vacía aunque tu server no valide auth.**
   `aiConfigured()` es `Boolean(process.env.AI_API_KEY)` (`provider.ts:93`). Si tu endpoint
   propio no requiere key y la dejás en `""`, `run.ts:261` toma el path **"no-ai"** y el
   chat responde "falta AI_API_KEY" (`run.ts:354-364`), y la memoria se apaga
   (`memory.ts:201,385`). **Footgun real:** hay que poner un valor dummy no vacío.

2. **`AI_EXTRA_BODY` es un hack específico del gateway DeepSeek/OpenCode Go y puede
   romper tu server.** Se mergea shallow e **incondicionalmente** al body de TODA request
   (`provider.ts:69-71`, `.env.example:40` = `{"thinking":{"type":"disabled"}}`). Muchos
   servers OpenAI-compatible rechazan con **400** parámetros top-level desconocidos. Al
   migrar hay que **vaciar `AI_EXTRA_BODY`** (o setear lo que tu runtime sí acepte).
   Es env, pero es un cambio obligatorio, no "dejalo como está".

3. **Timeouts calibrados a un gateway rápido.**
   - `AI_GENERATION_TIMEOUT_MS` default 25s (`provider.ts:104-107`). Un modelo propio chico
     en hardware modesto (cold start, cola, sin batching) puede tardar más → cae en
     `fallback-error` (`run.ts:381`, "Uy, tuve un problema..."). Se ajusta por env.
   - **PERO** el timeout del moderador LLM es `LLM_TIMEOUT_MS = 8_000` **hardcodeado**
     (`moderation.ts:104`), sin env. Si tu modelo propio hace la clasificación de seguridad
     en >8s, la capa 2 devuelve `available:false` (`moderation.ts:346,376`) → cae a
     fail-closed (más mensajes "moderación no disponible"). Ajustarlo **es cambio de
     código**, no env.
   - `CHAT_ROUTE_MAX_DURATION_S = 90` (`lib/ai/limits.ts:18`, atado a `maxDuration` en
     `route.ts:27` con assert). El self-host no cambia esto, pero un modelo lento + retry
     puede acercarse al techo.

4. **Presupuesto de contexto calibrado implícitamente al 1M de DeepSeek.**
   `estimateTokens = ceil(chars/4)` (`context-budget.ts:25-28`) es una heurística
   **model-agnostic pero aproximada**. Los `CONTEXT_BUDGETS` (`context-budget.ts:38-44`:
   system implícito + cards 800 + history 3000 + summaries 600 + memories 400 + rolling 500
   ≈ 5-6K tokens estimados) entran holgados en 1M. Un modelo propio chico suele tener
   ventana 4K-32K. Dos riesgos:
   - Para español rioplatense muchos tokenizers dan **~3 chars/token**, no 4 → los tokens
     REALES pueden ser mayores que el estimado → riesgo de overflow en ventana chica.
   - Si tu modelo propio tiene contexto reducido, hay que **re-tunear `CONTEXT_BUDGETS`** y
     quizá reemplazar `estimateTokens` por el tokenizer real del modelo. Es cambio de código
     localizado (una función pura), pero es cambio.
   - Nota: el `tokenize()` de selección de fichas (`system-prompt.ts:74-84`, acrónimos de 3
     letras CUD/TEA/TEL) es keyword-matching de dominio, **NO** tokenización de modelo → no
     se toca.

5. **Prompts calibrados a un modelo capaz (alignment/instruction-following).**
   El sistema entero asume que el modelo obedece instrucciones densas:
   - PERSONA con reglas no-negociables, frase de identidad EXACTA, proporcionalidad,
     anti-injection, registro etario (`system-prompt.ts:12-52,166-182`).
   - Moderador LLM que debe responder **SOLO JSON** `{"flagged":...,"category":...}`
     (`moderation.ts:249-271`). Si el modelo propio no adhiere, `parseLlmClassification`
     devuelve `unavailable()` más seguido (`moderation.ts:291-304`) → fail-closed.
   - Extracción de memoria/resúmenes que deben ser JSON y sin PII (`memory.ts:173-186`).
   Un modelo propio chico (1-3B, cuantizado) es **más débil** en todo esto que DeepSeek V4.
   Requiere **re-correr el gate completo** (`pnpm test`, la suite de crisis T1-T7 al 100%
   más las 225/1197 casos citadas en memoria/ARCHITECTURE) contra el modelo nuevo antes de
   confiar. Es "verificación", no "código", pero no es gratis.

6. **El moderador de capa 2 usa el MISMO modelo que la generación.**
   `smallModel()` cae a `AI_MODEL` si no hay `AI_SMALL_MODEL` (`provider.ts:88`). El diseño
   compensa el alignment débil del generador con la moderación obligatoria
   (ARCHITECTURE.md línea 21, Riesgo 1). Si tu modelo propio débil es **también** el
   moderador, la compensación se debilita justo donde importa. Mitigación sin tocar código:
   mantener `OPENAI_API_KEY` seteada (la capa 1 de la cascada, `omni-moderation-latest` en
   `moderation.ts:179`, es independiente del proveedor LLM y es el piso real de capa 2), o
   apuntar `AI_SMALL_MODEL` a un modelo distinto/más fuerte para moderar. Hoy la key OpenAI
   da 401 en prod (ARCHITECTURE.md línea 200) → la capa 2 corre solo con el LLM propio.

`resolveProvider`/health-tracking (`provider.ts:257-375`): **no afecta** el swap porque no
está en el hot path. Si además querés fallback (modelo propio primario, DeepSeek de
respaldo), activar el router en `generate.ts`/`moderation.ts`/`memory.ts` **sí es cambio de
código** (hoy llaman a `chatModel()`/`smallModel()` directo, no a `resolveProvider`).

**Resumen (a):** cambiás ~4 env vars, pero de verdad tenés que: (1) key dummy no vacía,
(2) vaciar `AI_EXTRA_BODY`, (3) subir `AI_GENERATION_TIMEOUT_MS` y evaluar el hardcode
`LLM_TIMEOUT_MS=8s`, (4) re-tunear `CONTEXT_BUDGETS`/tokenizer si la ventana es chica,
(5) re-correr el gate de crisis/moderación con el modelo nuevo, (6) decidir si el moderador
sigue siendo el mismo modelo débil. Nada de esto es enorme, pero "cero código" solo aplica
al happy path del cableado.

---

## (b) Inferencia CLIENT-SIDE en el navegador (WebLLM / transformers.js)

**Veredicto corto:** incompatible con el invariante duro de seguridad del producto tal como
está escrito. La razón es estructural, no de implementación: si el navegador genera, el
**texto crudo del LLM existe en un cliente no confiable ANTES de cualquier chequeo del
servidor**. No se puede "des-mostrar". El resto son mitigaciones, no garantías.

### Invariantes de seguridad que HOY dependen de que la inferencia sea server-side

| # | Invariante | Dónde vive | Por qué depende del server |
|---|---|---|---|
| I1 | **generar → moderar → mostrar, nunca streamear** | ARCHITECTURE.md L98; `respond.ts:39-54`; `run.ts:402-457` | La moderación de salida (`moderate(outputText)`, `run.ts:410`) corre sobre el texto ya generado, en el server, antes de responder. Client-side el texto ya está en el DOM del menor. |
| I2 | **Crisis/abuso/alimentario puentean el LLM con plantilla fija** | `safety.ts:148-235`; `run.ts:127,184-200` | Hoy corre sobre el input, server-side, y corta antes de generar. Es **portable a JS** (funciones puras), pero client-side no es *enforceable* contra un cliente manipulado. |
| I3 | **Sustitución segura de salida flaggeada** | `safety.ts:243-251`; `run.ts:426-457` | El server reemplaza el output del LLM por texto seguro y **nunca muestra el crudo**. Client-side el crudo ya se renderizó. |
| I4 | **Política fail-closed cuando la moderación por API cae** | `safety.ts:284-294`; `run.ts:459-509` | Decide server-side con estado de ambas capas. Depende de que el server vea input Y output. |
| I5 | **`SafetyEvent` auditable + `source` por capa** | `persist.ts` (`recordSafetyEvent`); `run.ts:161,298,427,476` | Registro server-side confiable. Si la moderación se va al cliente, los eventos dejan de ser confiables. |
| I6 | **Alertas al tutor (inmediata + por patrón)** | `notify.ts` (`alertGuardianSafely`, `maybePatternAlert`); `run.ts:192,310,334,443,494` | Se disparan por contenido detectado server-side (input y salida). Abuso en la SALIDA solo alerta si el server ve el output. |
| I7 | **Rate limiting por usuario (ráfaga + diario)** | `validate.ts` (`checkChatRateLimits`); `run.ts:97` (ADR-6, Postgres/Upstash) | Server-side por round-trip. Generación local sin round-trip = rate limit evitable. |
| I8 | **Persistencia (mensajes, conversación)** | `persist.ts` (`saveAssistant`), `conversation.ts` (`persistUserMessage`); `run.ts:133,591` | Postgres es la fuente para panel tutor, memoria, retención/TTL y auditoría. El assistant generado local hay que POSTearlo; un cliente puede omitirlo. |
| I9 | **Memoria / resúmenes sin PII + anti-injection** | `memory.ts` (`summarizeStaleConversation`, `updateRollingSummary`, `MEMORY_INJECTION_PATTERNS`) | Corren server-side sobre transcripts persistidos, con minimización PII y filtro de inyección en la escritura (`memory.ts:28-65,262-292`). Dependen de I8. |
| I10 | **RAG de fichas + system prompt CONFIDENCIAL** | `build-context.ts:38-41,161-168`; `system-prompt.ts:184-303` | El system prompt (PERSONA + delimitadores anti-injection) y el corpus (con `reviewed:false` excluido) se arman server-side y **nunca salen del server**. La PERSONA prohíbe revelar el system prompt (`system-prompt.ts:38`). Client-side hay que **enviar prompt + fichas al navegador** → quedan inspeccionables (jailbreak recon) y las defensas por delimitador (`stripDelimiterSequences`) pasan a ser seguridad-por-oscuridad inútil. |
| I11 | **Gate de consentimiento (Ley 25.326) + recheck TOCTOU** | `consent.ts` (`canUserChat`); `run.ts:84,569` | Un menor sin consentimiento de tutor no puede chatear. Solo se enforcea si el server media cada turno. |

### Qué es portable al navegador (barato, funciones puras, sin secretos)
- `safety.ts` completo: `detectSafetyFlag`, `normalizeForSafety`, `collapseLetterRuns`,
  plantillas `CRITICAL/ABUSE/HIGH_TEMPLATE`, `crisisReply` (`safety.ts:106-235`). **El piso
  de crisis puede correr client-side.**
- `chat-precedence.ts` (`decideResponsePath`, `decidePostGenPath`) — puro.
- `context-budget.ts` — puro (con la salvedad de la heurística `estimateTokens`).
- `parseLlmClassification` / `parseSummaryAndFacts` — puros (el parseo; la llamada al LLM
  usaría el modelo del cliente).

### Qué NO puede salir del server (secretos o confianza)
- **OpenAI Moderation API** (`moderation.ts:179`): usa `OPENAI_API_KEY` secreta → no se
  puede exponer en el browser. Capa 1 de capa 2 desaparece client-side.
- **`SafetyEvent`/persist/alertas** (secretos DB + email Resend).
- **Rate limit** (Postgres/Upstash).
- **Gate de consentimiento** (DB + sesión better-auth).
- **Memoria/resúmenes** (DB).
- **System prompt + corpus** (confidencialidad; exponerlos es regresión).

### Arquitecturas alternativas y qué preservan

**Opción A — Cliente genera, servidor modera con round-trip OBLIGATORIO antes de render.**
El cliente corre WebLLM para un *draft*, pero DEBE mandar `(input + draft)` al server, que
corre capa 1 (regex) + capa 2 (OpenAI Mod + LLM judge) y devuelve "aprobado" (render) o
"reemplazado" (render de la sustitución segura). El cliente renderiza SOLO tras el veredicto.
- Preserva I1/I3/I4/I5/I6 **solo si el cliente es honesto y espera**. En un browser no se
  puede *forzar* contra un cliente manipulado: el crudo ya está en memoria/DOM. Para el
  modelo de amenaza de menores (el propio menor jailbrikeando, o output autolesivo) "no
  enforceable" es el kill: la garantía dura se pierde.
- Gana **latencia percibida y costo de API** (la generación es local). No gana seguridad.
- Veredicto: aceptable como optimización de costo/latencia para clientes honestos, **no**
  como sustituto del invariante I1.

**Opción B — Modo degradado offline (fallback acotado).**
El modelo client-side entra **solo** cuando el server está caído/offline, con alcance
recortado y explícito:
- Regex de crisis (`safety.ts`, portable) corre local; ante cualquier hit → plantilla fija
  local (las plantillas son estáticas, portables). Preserva I2 como piso.
- Moderación de salida local = solo `detectSafetyFlag(output)` (regex), que la propia
  arquitectura trata como **piso, no techo** (`safety.ts:288`, comentario en `run.ts:459`).
  Se pierde capa 2 (OpenAI + LLM judge) offline.
- Al reconectar: sincronizar transcripts → moderación server + auditoría + alertas
  retroactivas (I5/I6 diferidas). Banner de degradación explícito en UI.
- Preserva I2 y una versión débil de I1 (generar-completo → regex → mostrar, sin capa 2).
  I5/I6 pasan a async. Es un modo genuinamente degradado, **acotado y señalizado**, no el
  modo normal.

**Opción C — Híbrido "sensible al server, trivial al cliente".** No es coherente para
menores: no se puede saber si un turno es sensible *antes* de generarlo, así que no hay
forma segura de rutear. Descartable.

### Riesgos adicionales específicos de WebLLM/transformers.js
- **Peso del modelo**: cientos de MB a varios GB de weights por descarga, pesado para la
  audiencia (chicos, dispositivos posiblemente de gama baja, requisitos de accesibilidad de
  research-safety §7). Choca con el objetivo de bajo costo/inclusión.
- **Capacidad**: un modelo que corre in-browser (~1-3B, 4-bit) es **más débil** en español
  rioplatense, adherencia a JSON y rechazos sensibles que DeepSeek V4 — exactamente donde la
  moderación importa. Y si ese mismo modelo débil es también el moderador (Opción A/B), la
  red de seguridad se degrada en paralelo con la generación.

**Resumen (b):** la generación server-side es la única arquitectura que *enforcea*
moderar-antes-de-exponer. Client-side solo cabe como (1) modo degradado offline con piso
regex + plantillas portables + sync obligatorio al reconectar + banner, o (2) acelerador de
costo/latencia con round-trip de moderación para clientes honestos — ninguno preserva el
invariante duro I1, y ambos agregan la regresión de exponer system prompt + corpus (I10) al
navegador.
