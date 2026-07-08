# Simón AI — Research UX/UI (Fase 2) y Moderation API (Fase 1)

**Fecha:** 2026-07-08
**Alcance:** Este doc construye sobre `research-safety.md` §7 (UX y accesibilidad ya cubiertas: legibilidad por edad, contraste WCAG AA, touch targets, dark patterns, consideraciones neurodivergentes). Acá NO se repite eso — se agregan tendencias visuales 2026, patrones de interacción concretos, y el estado actual de moderation APIs para informar Fase 1/Fase 2 de implementación.

**UI actual (referencia):** `simon/src/components/chat.tsx` — chat minimalista Tailwind v4, paleta zinc/amber, burbujas redondeadas sin avatar, banner de disclosure fijo, `aria-live="polite"`, sin quick-replies, sin voice input, sin modo calma, sin `prefers-reduced-motion`.

---

## 1. UI/UX 2026 para chat infantil-adolescente

### 1.1 Tendencias 2026: calm design en apps de bienestar

El diseño 2026 en mental health apps se aleja de la gamificación agresiva hacia "calm design": paletas pastel muteadas, componentes redondeados, layouts minimalistas, transiciones lentas y deliberadas, y microinteracciones estratégicas en vez de motion extravagante. La tendencia explícita es reemplazar "streaks" (métricas de racha) por "nudges" suaves — mensajes como "acá estoy cuando me necesites" en vez de lenguaje que presiona el regreso diario. Esto confirma y refuerza el veto a streak mechanics que ya está en `research-safety.md` §7.5, y agrega una dirección visual concreta (paleta muteada + motion lento) que la paleta zinc/amber actual ya se acerca a cumplir pero sin motion design definido.
Fuente: [Envato — UX/UI design trends 2026: calm interfaces](https://elements.envato.com/learn/ux-ui-design-trends)

### 1.2 Mascota/avatar de Simón: ¿ayuda o riesgo?

La evidencia es clara en que elementos antropomórficos (pronombres en primera persona, avatares personalizables, nombres propios) aumentan el riesgo de que niños perciban al chatbot como un ser con capacidad real de ver, oír o sentir — efecto documentado incluso en niños pequeños vía activación cerebral. Al mismo tiempo, el caso de Headspace (Ebb) muestra que un diseño de personaje NO es intrínsecamente peligroso si se ejecuta con las salvaguardas correctas: eligieron una forma abstracta ("blob" amistoso) en vez de humana o de asistente de voz genérico, con expresión "escuchando" pero no eufórica (para no invalidar emociones pesadas), motion tipo "lava lamp" que transmite que las emociones fluyen, y — clave — priorizaron que el usuario SIEMPRE reconozca que interactúa con IA, con onboarding explícito de que Ebb es soporte complementario entre sesiones de terapia, no reemplazo. Recomendación para Simón: si se agrega un avatar, usar forma abstracta/no-humana (no cara humana, no género marcado), sin nombre de mascota separado del nombre "Simón", sin expresiones de alegría excesiva, y mantener el disclosure de IA visible permanentemente (ya cumplido parcialmente por el banner ámbar actual).
Fuentes: [Figma Blog — Headspace Ebb AI companion](https://www.figma.com/blog/headspace-ebb-ai-companion/); [arXiv 2512.02179 — Young children's anthropomorphism of an AI chatbot](https://arxiv.org/pdf/2512.02179); [Public Citizen — Chatbots Are Not People](https://www.citizen.org/article/chatbots-are-not-people-dangerous-human-like-anthropomorphic-ai-report/)

### 1.3 Quick-reply chips y selector pictográfico de emociones

El patrón dominante en chatbots de salud mental analizados (Wysa, Woebot, etc.) es la "conversación guiada": el usuario responde principalmente mediante botones/chips preseteados en vez de texto libre, reduciendo fricción y ambigüedad — Woebot es de los pocos que ofrece modo semi-guiado (chip o texto libre a elección). Wysa refuerza esto con su mascota pingüino apareciendo junto a los inputs y reaccionando en el chat, dando calidez sin reemplazar el chip como mecanismo principal de entrada. Para Simón esto es directamente accionable: agregar chips de "¿cómo te sentís?" (contento/triste/enojado/ansioso/no sé) al inicio de sesión y después de mensajes largos del usuario reduce la carga de escribir, ayuda a usuarios con dificultades motoras o de literacidad, y es consistente con el check-in de 3 puntos ya recomendado en `research-safety.md` SH-C2.
Fuentes: [PMC — Overview of chatbot-based mobile mental health apps](https://pmc.ncbi.nlm.nih.gov/articles/PMC10242473/); [Golden Owl — Chatbot UI design examples 2026](https://goldenowl.asia/blog/chatbot-ui-design)

### 1.4 Voice input: Web Speech API en 2026

La Web Speech API (`SpeechRecognition`) sigue viva en 2026 pero con soporte fragmentado: funciona en Chrome, Edge, Safari (macOS 14.1+/iOS 14.5+) y Samsung Internet, mientras Firefox la mantiene detrás de un flag y nunca llegó a Opera/IE — es decir, no hay garantía cross-browser, hay que tratarla como progressive enhancement. El español está bien cubierto: la API lista variantes regionales explícitas incluyendo `es-AR` (Argentina) entre más de 20 locales de español. La limitación técnica real es que en Chrome y navegadores similares el reconocimiento es server-based (audio viaja a servidores de Google), lo que exige conexión a internet y tiene implicancia de privacidad para conversaciones de salud mental de menores — esto debe declararse en el consentimiento parental si se implementa voice input.
Fuentes: [MDN — Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API); [caniuse — Speech Recognition API](https://caniuse.com/speech-recognition); [TestMu AI — Speech Recognition API browser support](https://www.testmuai.com/learning-hub/speech-recognition-api-browser-support/)

### 1.5 Motion, calma sensorial y accesibilidad práctica

Para usuarios con sensibilidades sensoriales (autismo, ADHD) la recomendación consistente en 2026 es interfaz predecible con mínimas distracciones, colores calmos, layouts simples, e interacciones sin sorpresas — reforzando lo que `research-safety.md` §7.4 ya prescribe, con el agregado de que la personalización sensorial debe existir como opción pero la funcionalidad núcleo debe seguir siendo accesible sin configurar nada (no forzar a un chico a configurar antes de poder hablar con Simón). En términos de implementación web, esto se traduce directamente en respetar `prefers-reduced-motion` en cualquier animación que se agregue (typing indicator, transiciones de mensaje, mascota) y ofrecer un toggle manual de "modo calma" independiente de la preferencia del sistema operativo, porque no todos los dispositivos de uso compartido (tablet familiar) exponen esa preferencia por usuario.
Fuente: [Tiimo — Sensory-friendly design for ADHD and Autism](https://www.tiimoapp.com/resource-hub/sensory-design-neurodivergent-accessibility)

### 1.6 Lista priorizada de mejoras concretas para la UI actual

| # | Mejora | Esfuerzo | Por qué |
|---|---|---|---|
| 1 | Chips de check-in emocional (3-5 opciones) al iniciar sesión y tras mensajes largos | **S** | Reduce fricción de escritura, cumple SH-C2/SH-U2 de safety doc, patrón validado en Wysa/Woebot (§1.3) |
| 2 | `prefers-reduced-motion` en cualquier animación (typing indicator `animate-pulse` ya existe y debe respetar la media query) | **S** | Ya hay una animación (`animate-pulse` en "Simón está escribiendo…") sin guard; 1 línea de CSS/Tailwind arregla el gap de accesibilidad |
| 3 | Toggle manual de "modo calma" (reduce motion + paleta más muteada) independiente del OS | **S** | No todos los dispositivos exponen la preferencia por usuario (tablet compartida); accionable con una sola variable de estado + clase condicional |
| 4 | Etiqueta visible "Simón:" / "Vos:" antes de cada burbuja (no solo color) | **S** | Hoy la distinción rol es solo por alineación/color; screen readers y daltonismo necesitan texto (SH-U5 / §7.4 visual impairment) |
| 5 | Botón/link permanente y visible de líneas de ayuda (no solo el banner ámbar inicial que se pierde al hacer scroll) | **S** | §7.3 de safety doc exige "botones de recursos de crisis permanentemente accesibles en UI"; hoy solo aparece arriba del todo |
| 6 | Selector pictográfico de emoción (caritas/iconos) como alternativa a los chips de texto para 6-10 años | **M** | Ayuda a literacidad baja y discapacidad intelectual (SH-DS1/DS3); requiere set de iconos + mapeo a texto accesible |
| 7 | Voice input opcional vía Web Speech API con fallback visible si no está soportado | **M** | Soporta `es-AR`; mejora accesibilidad motora/literacidad (SH-U3), pero requiere manejar fallback de navegador y disclosure de envío de audio a terceros |
| 8 | Timer de sesión visible (cuenta ascendente sutil, no countdown ansiógeno) + mensaje de cool-down a los 30 min | **M** | Requerido por M-S7 de safety doc; hoy no existe ningún control de duración de sesión en la UI |
| 9 | Avatar abstracto no-humano para Simón (opcional, forma tipo "blob"/ícono geométrico, sin rasgos faciales expresivos) | **M** | Balance entre calidez y riesgo de antropomorfización (§1.2); si se hace, debe evitar cara humana y expresiones "felices" ante mensajes tristes |
| 10 | Mood-trend view simple (últimas N sesiones, 3 puntos) visible al usuario, no solo al padre | **M** | Cierra el loop de SH-C3 ("¿cómo te sentís ahora comparado con...?") con algo visual, sin exponer transcripts |
| 11 | Modo alto contraste explícito (además de dark mode) | **M** | §7.3 pide "high-contrast mode" separado de dark mode; Tailwind ya tiene tokens zinc, falta la variante de alto contraste real (no solo invertir colores) |
| 12 | Rediseño completo de paleta/tipografía/ilustración de marca (Fase 2 mayor) | **L** | Alcance de un rediseño real de identidad visual — requiere Inspiration Brief propio, no es un parche incremental sobre zinc/amber actual |

---

## 2. OpenAI Moderation API — estado julio 2026

### 2.1 Endpoint, modelo y límites

`omni-moderation-latest` sigue siendo el modelo vigente y más capaz del endpoint de moderación de OpenAI a julio 2026, construido sobre GPT-4o y con soporte de texto + imágenes. Sigue siendo gratuito: el endpoint de moderación está explícitamente excluido del uso facturable y no cuenta contra los límites mensuales de uso de la cuenta. Los rate limits escalan por tier de cuenta: tier gratuito ronda 250 RPM / 5.000 RPD / 10.000 TPM, y en tiers pagos superiores (Tier 2+) el límite diario se elimina y solo queda el límite por minuto (hasta 500 RPM en Tier 5) — para Simón en producción con tráfico bajo-medio esto no debería ser un cuello de botella, pero conviene monitorear el tier de la cuenta si el volumen de mensajes escala.
Fuentes: [OpenAI — omni-moderation-latest model docs](https://developers.openai.com/api/docs/models/omni-moderation-latest); [Evolink — OpenAI Moderation API pricing](https://evolink.ai/blog/openai-moderation-api-pricing); [OpenAI Community — Rate limits for omni-moderation by tier](https://community.openai.com/t/rate-limits-for-omni-moderation-based-on-tier/1377984)

### 2.2 Calidad en español y categorías self-harm

El modelo omni-moderation mejoró significativamente el desempeño multilingüe respecto al modelo de texto anterior: en una evaluación de 40 idiomas mejoró en el 98% de los casos, y específicamente en español (junto con alemán, italiano, portugués, francés) el desempeño post-mejora supera incluso el desempeño en inglés del modelo previo — es una señal fuerte de que el español rioplatense debería estar bien cubierto, aunque no hay benchmark específico publicado para variantes regionales de español (argentino vs. neutro). Las categorías relevantes para Simón existen tal como se necesitan: `self-harm`, `self-harm/intent` y `self-harm/instructions` están entre las categorías detectadas por el modelo, cubriendo tanto ideación como instrucciones de método — esto valida el diseño de Layer 1/2 del protocolo de crisis en `research-safety.md` §3.2, que puede apoyarse en estas categorías como señal adicional (no reemplazo) del clasificador NLP propio.
Fuentes: [OpenAI — Upgrading the Moderation API with multimodal model](https://openai.com/index/upgrading-the-moderation-api-with-our-new-multimodal-moderation-model/); [AI Moderation Tools — OpenAI Moderation API review 2026](https://aimoderationtools.com/posts/openai-moderation-api-review/)

### 2.3 Alternativa: Mistral Moderation API

Mistral ofrece una API de moderación propia (modelo Ministral 8B afinado) con dos endpoints — texto crudo y contenido conversacional — clasificando en 9 categorías incluyendo `self-harm`, `health`, y contenido sexual/violento, con soporte multilingüe nativo que incluye español entre sus idiomas entrenados explícitamente. A diferencia de OpenAI, la documentación pública no confirma un tier gratuito equivalente (el pricing es "según uso" en la plataforma de Mistral), y Mistral no publica el mismo nivel de detalle de benchmarks multilingües por idioma que OpenAI sí publicó en su anuncio de 2024. Para Simón, dado que ya es gratis, sin límite diario relevante en tiers pagos, y con español validado con benchmarks públicos, OpenAI Moderation sigue siendo la opción por defecto; Mistral queda como fallback/segunda opinión si se quiere redundancia de dos proveedores independientes para casos borderline (defense in depth), no como reemplazo primario.
Fuentes: [Mistral AI — Mistral Moderation API announcement](https://mistral.ai/news/mistral-moderation/); [Mistral Docs — Moderation model card](https://docs.mistral.ai/models/model-cards/mistral-moderation-24-11)

### 2.4 Latencia y patrón recomendado para streaming

La latencia típica reportada del endpoint de moderación de OpenAI es de 15-25ms — funcionalmente despreciable comparado con la latencia de generación del LLM, lo que hace totalmente viable moderar el input del usuario de forma síncrona antes de llamar al LLM (Layer 1 del protocolo de crisis) sin impacto perceptible en UX. El problema real es moderar el output que ya está siendo streameado al usuario: la literatura reciente describe dos patrones viables — (a) "stream-then-buffer-on-suspicion": el stream pasa sin bloquear mientras un clasificador liviano basado en reglas vigila triggers, y si dispara, se cambia a modo buffer y se evalúa con un clasificador más pesado antes de continuar/cortar; (b) evaluación por chunks de tamaño fijo (128-256 tokens) con ventanas superpuestas para no perder contenido que cruza el límite de un chunk. Para Simón, dado que las respuestas ya pasan por un system prompt con límites duros y un post-generation filter está listado como MUST en `research-safety.md` M-S2, el patrón más simple y seguro es: moderar el input siempre pre-LLM (síncrono, 15-25ms, sin costo), y para el output usar buffer completo antes de empezar a streamear al usuario en vez de moderar chunk-a-chunk — dado que las respuestas de Simón son cortas (2-4 oraciones por diseño, SH-U1), el costo de latencia de esperar la respuesta completa antes de moderar y recién ahí streamear (o simplemente no streamear y enviar de una vez) es marginal y elimina el riesgo de que contenido no seguro llegue a un menor a mitad de generación.
Fuentes: [Portkey — Benchmarking omni-moderation-latest](https://portkey.ai/blog/openai-omni-moderation-latest-benchmark/); [arXiv 2506.09996 — Early stopping LLM harmful outputs via streaming content monitoring](https://arxiv.org/html/2506.09996v1); [NVIDIA — NeMo Guardrails LLM output streaming](https://developer.nvidia.com/blog/stream-smarter-and-safer-learn-how-nvidia-nemo-guardrails-enhance-llm-output-streaming/)

---

## Recomendaciones para el orquestador

- **Fase 1 (moderation):** usar `omni-moderation-latest` sync pre-LLM (gratis, 15-25ms, categorías self-harm/intent/instructions ya cubren la taxonomía T1-T3 del protocolo de crisis) y NO streamear la respuesta del LLM al usuario — generar completo, correr post-generation filter, recién entonces mostrar. Dado que los mensajes de Simón son cortos por diseño, el costo de UX de no streamear es bajo y elimina el riesgo de leak de contenido inseguro a mitad de generación.
- **Fase 1 (moderation, redundancia):** evaluar Mistral Moderation como segunda opinión solo en casos borderline (score de OpenAI cerca del threshold), no como reemplazo — sin tier gratuito confirmado y sin benchmark público de español, no reemplaza a OpenAI como capa primaria.
- **Fase 2 (UI, quick wins S):** priorizar en el próximo sprint las 5 mejoras "S" de la tabla §1.6 (chips de check-in, `prefers-reduced-motion`, modo calma, etiqueta de rol visible, botón de ayuda permanente) — son cambios acotados sobre `chat.tsx` que cierran gaps de accesibilidad ya prescriptos en `research-safety.md` §7 pero no implementados hoy.
- **Fase 2 (avatar):** si se decide agregar mascota/avatar a Simón, replicar el patrón Headspace/Ebb — forma abstracta no-humana, sin expresiones eufóricas, disclosure de IA siempre visible — para no repetir el error de antropomorfización que causó dependencia en Character.AI/Replika (ya documentado en research-safety.md §1).
- **Fase 2 (voice input):** implementar como progressive enhancement con Web Speech API (soporta `es-AR`), con fallback explícito para Firefox/navegadores sin soporte, y declarar en el consentimiento parental que el audio puede procesarse en servidores de terceros (Chrome usa reconocimiento server-side).
