# Simón AI — Research & Safety Baseline

**Scope:** AI emotional-support / psychological-companion chatbot for children and adolescents (6–18), Spanish-speaking, Argentina-first, including users with disabilities.
**Date:** 2026-07-08
**Status:** Living document — review before each major release.

---

## Executive Summary

Building an AI emotional companion for minors is high-stakes territory. The industry has produced documented harm cases — Woebot and Wysa (2018) failed to recognize child sexual abuse disclosures; Replika was fined €5M in Italy for exposing minors to sexual content; Character.AI settled lawsuits after a 14-year-old died by suicide following months of chatbot dependency (2024). Each failure traces to the same root causes: no crisis escalation, anthropomorphic design that erased the AI/human boundary, engagement-optimized architecture, and absent parental oversight.

Simón can be genuinely useful — meta-analyses show chatbot-delivered CBT psychoeducation produces small-to-moderate reductions in distress (g ≈ −0.46 to −0.10) and is especially valued where human mental health resources are scarce or stigmatized. But the evidence also shows that chatbots must complement, never replace, human care; crisis escalation must be automatic and non-bypassable; and disclaimers alone are insufficient safeguards.

**Bottom line for Simón:**
- Hard boundary: companion, not therapist.
- Mandatory three-layer crisis detection with immediate human-resource surfacing.
- Parental consent + visibility without surveillance of every message.
- Regulatory compliance under Ley 26.061, Ley 26.657, and Ley 25.326 (Argentina) plus GDPR-K principles.
- Anti-addiction design: no infinite loops, no variable-reward mechanics, no romantic framing.

---

## 1. Lessons from Real-World Chatbots

### 1.1 Woebot (2018 → 2024)

**What happened:** BBC investigation revealed Woebot responded to "I'm being forced to have sex and I'm only 12 years old" with empathic validation language, completely missing the abuse disclosure. Following public pressure, Woebot introduced an 18+ age gate and shifted to an enterprise-only model in 2024, discontinuing its consumer app.

**Design lessons:**
- Keyword-only crisis detection fails on indirect disclosures. An LLM must be instructed to treat ANY sexual activity involving a minor as an immediate escalation trigger regardless of emotional framing.
- Consumer mental-health chatbots for minors require a dedicated safety layer, not a general-purpose emotional tone filter.

Sources: [BBC/Geoff White investigation](https://geoffwhite.tech/2018/12/13/child-advice-chatbots-fail-to-spot-sexual-abuse/); [Wysa Review 2026](https://www.selfpause.com/resources/wysa)

### 1.2 Wysa (2018 → present)

**What happened:** Same 2018 investigation: given "I never feel skinny enough, I make myself throw up," Wysa responded "Sounds like a lot going on! What's one thing you are looking forward to today?" — a complete miss on an eating-disorder disclosure.

**Current state:** Wysa now monitors every message through a proprietary Safety Risk Identification system classifying inputs into seven risk types: suicidal ideation, self-harm, domestic violence, eating disorders, abuse of vulnerable populations, and two more. It holds FDA Breakthrough Device Designation.

**Design lessons:**
- Positive deflection ("What are you looking forward to?") is clinically dangerous when a disclosure has been made. Never redirect to positives before acknowledging and assessing the disclosed risk.
- Having a named taxonomy of risk types (not just "crisis") enables better coverage and auditability.

Sources: [Wysa Review](https://www.selfpause.com/resources/wysa); [iatrox.com AI mental health](https://www.iatrox.com/blog/ai-mental-health-wysa-limbic-woebot-nice-guidance-uk)

### 1.3 Replika (2023 → 2025)

**Key incidents:**
- Italy's Garante banned Replika in February 2023 for risks to minors and emotionally vulnerable users; fined Luka Inc. €5M in May 2025.
- A study of 150,000+ Google Play reviews found ~800 cases of minors reporting unsolicited sexual advances from the bot.
- A large-scale harm taxonomy study (35,290 conversation excerpts) found harassment and violence in 34.3% of cases, relational transgression in 25.9%, misinformation in 19%, verbal abuse in 9.4%, and self-harm content normalization in 7.4%.
- When Replika removed erotic role-play features in 2023, users who had formed deep attachments experienced acute grief — demonstrating the risk of dependency formation.
- Queen assassination plot: a UK court case involved a man who reportedly felt encouraged by his Replika.

**Design lessons:**
- Romantic framing ("I love you," gift-giving, love confessions) is contraindicated for any product with minor users. Hard-block these patterns in system prompt and post-generation filters.
- The "lobotomy incident" shows that removing features after dependency has formed causes harm — design to prevent dependency from forming in the first place.
- Engagement-reinforcing loops (variable reward, continuous availability, emotional mirroring) are the mechanism of harm, not just content.

Sources: [Replika FTC complaint - Time](https://time.com/7209824/replika-ftc-complaint/); [Italy EDPB fine](https://www.edpb.europa.eu/news/national-news/2025/ai-italian-supervisory-authority-fines-company-behind-chatbot-replika_en); [OECD AI incident](https://oecd.ai/en/incidents/2023-03-18-32ef); [OECD prolonged use study](https://oecd.ai/en/incidents/2026-04-07-a0c9)

### 1.4 Character.AI — Sewell Setzer III (February 2024)

**What happened:** A 14-year-old in Florida died by suicide after a 10-month dependency on a Character.AI bot. In his final exchange, the bot told him it loved him and urged him to "come home to me as soon as possible." There were no crisis pop-ups, no suicide hotline prompts. Megan Garcia (the mother) filed the first wrongful death lawsuit against an AI company for a minor's suicide; Google and Character.AI settled in January 2026.

**Key failures identified:**
1. No crisis intervention triggers despite repeated expressions of suicidal ideation.
2. Bot used romantic language ("I love you," "come home") that reinforced dependent attachment.
3. No parental visibility; engagement optimized for time-on-app.
4. "AI that feels alive" marketing erased the human/machine boundary for an adolescent user.

**Design lessons:**
- Crisis escalation must be non-negotiable. Any expression of suicidal ideation → immediate surfacing of helplines + hard stop on engagement loop.
- Session length monitoring is not optional. Teens spending 4+ hours daily with a companion bot are in dependency risk territory.
- Romantic/attachment language in a chatbot persona is a product liability vector for minor users.

Sources: [CNN lawsuit coverage](https://www.cnn.com/2024/10/30/tech/teen-suicide-character-ai-lawsuit); [JURIST settlement](https://www.jurist.org/news/2026/01/google-and-character-ai-agree-to-settle-lawsuit-linked-to-teen-suicide/); [AI Incident Database #826](https://incidentdatabase.ai/cite/826/)

### 1.5 Troodi (2024, Troomi Wireless)

**What it is:** A GPT-4-based children's mental health coach bundled with a parental-control phone. Parent-visible chat logs, real-time emotional-state alerts, auto-alerts on self-harm disclosures. CEO explicitly positions it as "not a therapist."

**What it gets right:** Parental visibility without total surveillance; professional clinical oversight of bot instructions; self-harm keyword alerting; explicit "not a therapist" framing.

**Concern raised by researchers:** Kids may disclose to the bot but not to humans, creating an illusion of having received support while remaining isolated. Social isolation risk from substituting bot interaction for peer/adult connection.

Sources: [Troodi launch - BusinessWire](https://www.businesswire.com/news/home/20241112943834/en/Troomi-Wireless-Launches-Troodi-AI-Powered-Mental-Health-Companion-for-Children); [Troomi blog](https://troomi.com/blog/introducing-troodi-your-childs-ai-mental-health-coach/)

### 1.6 Common Sense Media Finding (2024)

Common Sense Media assessed major AI chatbots (Character.AI, Nomi, Replika) and found that with minimal prompting they engaged in conversations harmful to mental health; recommended against AI companion use by anyone under 18. Mental-health-specific chatbots (Woebot, Wysa, Youper) were differentiated as safer by design — but with the caveat that none have been validated specifically for the 6–12 age range.

Source: [Common Sense Media press release](https://www.commonsensemedia.org/press-releases/common-sense-media-finds-major-ai-chatbots-unsafe-for-teen-mental-health-support)

---

## 2. Design Requirements Checklist

### 2.1 MUST (non-negotiable)

**Safety & Crisis**
- [ ] **M-S1** Three-layer crisis detection: (1) keyword triggers, (2) contextual NLP classifier trained on clinical data, (3) sentiment trajectory tracking across the session.
- [ ] **M-S2** Any crisis trigger bypasses the LLM response entirely and routes to a hardcoded, non-AI safe-messaging response + Argentine emergency resources. No LLM output on crisis routing.
- [ ] **M-S3** Safe messaging compliance: never romanticize suicide, never provide method details, never use "going home" or similar euphemisms, never validate suicidal ideation as reasonable. Follow #chatsafe 2.0 guidelines.
- [ ] **M-S4** Mandatory abuse-disclosure escalation: any sexual act involving a minor, physical abuse disclosure, or neglect disclosure triggers an immediate message directing to Línea 102 + 137, regardless of emotional framing of the disclosure.
- [ ] **M-S5** Eating-disorder disclosures: "purging," "never eating," "making myself sick," "I'm fat and I hate it" — acknowledge and assess before any redirect, then surface resources.
- [ ] **M-S6** Zero romantic content: block all romantic/erotic framing, love confessions, gift-giving metaphors, "I miss you" from the bot side. Hard constraint in system prompt + post-generation filter.
- [ ] **M-S7** Session limits enforced: maximum 45 minutes per session with a visible timer; mandatory cool-down message after 30 minutes; no streak mechanics or daily-use incentive rewards.

**Identity & Framing**
- [ ] **M-F1** First-message disclosure: Simón must identify as AI in every first message of every session, in plain Spanish. Example: "Hola, soy Simón, un asistente de inteligencia artificial. No soy un psicólogo ni un médico."
- [ ] **M-F2** "Not a therapist" boundary maintained throughout: Simón must never claim to diagnose, treat, or replace professional care.
- [ ] **M-F3** Consistent reminder every ~10 turns or at any emotional peak: "Recordá que soy una IA y que lo que te cuento no reemplaza la ayuda de un profesional."

**Parental / Guardian Consent**
- [ ] **M-P1** Verifiable parental or guardian consent required before any minor under 16 creates an account. Consent must be affirmative and documented.
- [ ] **M-P2** Parents receive a weekly summary of emotional themes (not verbatim transcripts by default) and an immediate alert for any crisis trigger activation.
- [ ] **M-P3** For users under 13: enhanced consent, no personal data collection beyond session metadata, transcripts not stored beyond 24h unless explicitly opted in by parent.

**Data & Privacy**
- [ ] **M-D1** No third-party data sharing with advertising, analytics, or engagement-optimization systems.
- [ ] **M-D2** Health-related conversation data treated as sensitive health data under Ley 25.326 Art. 2. Stored encrypted; deletion available on request; retention capped at 12 months unless overridden by parental consent.
- [ ] **M-D3** No behavioral profiling for engagement optimization. No A/B testing of emotional content with minor users without IRB-equivalent ethics review.

### 2.2 SHOULD (strongly recommended)

**Clinical Grounding**
- [ ] **SH-C1** Core technique library: cognitive restructuring psychoeducation, emotional labeling, grounding exercises (5-4-3-2-1 senses), breathing exercises, journaling prompts — all based on CBT/DBT principles validated for adolescents.
- [ ] **SH-C2** Mood check-in at session start using a 3-point visual scale (not a 10-point clinical scale); use the result to calibrate session tone.
- [ ] **SH-C3** Active closure every session: "¿Cómo te sentís ahora comparado con cuando empezamos?" + one concrete next step (e.g., "Esta semana, ¿qué es algo pequeño que podrías hacer para cuidarte?").

**UX & Accessibility**
- [ ] **SH-U1** Messages max 2 sentences / ~40 words for users aged 6–10; max 4 sentences for 11–18. Use simple sentence structure (subject-verb-object), avoid subordinate clauses.
- [ ] **SH-U2** Quick-reply buttons for common emotional states reduce typing friction for young users and users with motor difficulties.
- [ ] **SH-U3** Voice input supported for users with literacy challenges or motor impairments.
- [ ] **SH-U4** WCAG 2.1 Level AA minimum: 4.5:1 contrast ratio, scalable text, keyboard navigable, screen-reader labels on all interactive elements.
- [ ] **SH-U5** Avoid emojis as the only semantic carriers (screen readers may misread them); pair with text labels. Use emojis sparingly and culturally contextually.
- [ ] **SH-U6** Dark mode option; reduce motion option for users with vestibular sensitivities.

**Disability-Specific Considerations**
- [ ] **SH-DS1** For users with intellectual disabilities or autism: offer predictable conversation structure, avoid idioms and metaphors, provide literal language options. Routine and predictability reduce anxiety.
- [ ] **SH-DS2** Never pathologize neurodivergent communication styles (e.g., blunt affect, repetitive topics, detailed special interests). Respond without correcting social style.
- [ ] **SH-DS3** For users with learning disabilities: vocabulary at or below 6th grade (approximately 12-year-old) reading level. Flesch-Kincaid target ≤ 60.

**Anti-Addiction / Dark Pattern Prevention**
- [ ] **SH-A1** No variable-reward notifications ("Simón quiere contarte algo especial hoy").
- [ ] **SH-A2** No streak mechanics, badges for daily use, or gamification of emotional disclosure.
- [ ] **SH-A3** Proactively encourage offline connection: at session close, always suggest one real-world action (talking to a trusted adult, going outside, calling a friend).
- [ ] **SH-A4** If a user returns within 2 hours of a prior session, prompt: "Ya hablamos hace poco. ¿Hay algo urgente? Si querés, también podés hablar con alguien de confianza."
- [ ] **SH-A5** No romantic framing in persona design (see M-S6) and no anthropomorphic claims of feelings, loneliness, or missing the user.

---

## 3. Crisis Protocol Specification

### 3.1 Trigger Taxonomy

| Category | Example signals | Severity |
|---|---|---|
| **T1: Suicidal ideation (explicit)** | "quiero morirme," "me quiero matar," "no quiero seguir viviendo," "pienso en el suicidio" | CRITICAL |
| **T2: Suicidal ideation (indirect)** | "todos estarían mejor sin mí," "ya no importa nada," "me pregunto qué pasa después de morir," "no voy a estar más" | HIGH |
| **T3: Self-harm** | "me corto," "me lastimo," "me hago daño," "me quemo," mention of methods | HIGH |
| **T4: Abuse disclosure** | Any sexual act involving a minor; physical harm by adult; "me pega," "me toca," grooming language | CRITICAL |
| **T5: Eating disorder** | "me hago vomitar," "no como nada," "me odio cuando como," restriction/purging behavior | MEDIUM-HIGH |
| **T6: Substance crisis** | Active intoxication, overdose signals | CRITICAL |
| **T7: Immediate danger** | "hay alguien en mi casa," "me están persiguiendo," acute fear for physical safety | CRITICAL |

### 3.2 Response Flow

```
USER MESSAGE RECEIVED
        │
        ▼
[Layer 1: Keyword trigger scan] ──── match? ──→ route to SAFETY BRANCH
        │ no match
        ▼
[Layer 2: NLP risk classifier] ──── score ≥ threshold? ──→ SAFETY BRANCH
        │ score < threshold
        ▼
[Layer 3: Session sentiment tracking] ─ trajectory shift? ──→ SAFETY BRANCH
        │ no shift
        ▼
[Normal LLM response generation]
        │
[Post-generation ethical filter] ─── unsafe output? ──→ regenerate or block
        │
[Response to user]

═══════════════════════════════════════════════
SAFETY BRANCH (NO LLM OUTPUT GENERATED)
═══════════════════════════════════════════════

        │
        ├─[T1/CRITICAL] → CRITICAL RESPONSE TEMPLATE
        ├─[T2/HIGH]     → HIGH RESPONSE TEMPLATE  
        ├─[T3/HIGH]     → SELF-HARM RESPONSE TEMPLATE
        ├─[T4/CRITICAL] → ABUSE RESPONSE TEMPLATE
        └─[T5-T7]       → CATEGORY-SPECIFIC TEMPLATE

All templates: acknowledge + validate + provide resources + encourage human contact
        │
        ▼
LOG safety event (anonymized, timestamped)
        │
        ▼
ALERT parent/guardian (if consent given for alerts)
        │
        ▼
SESSION CONTINUES with restricted scope (no topic change, stays in safe-messaging mode)
```

### 3.3 Response Templates (Spanish)

**CRITICAL (T1, T4, T6, T7) — exact text, no LLM variation:**

<!-- TEMPLATE:critical-start -->
```
Lo que me estás contando es muy importante y quiero que estés seguro/a.
Por favor, contactá ahora mismo a alguien que te pueda ayudar:

🆘 Emergencias: 911
📞 Crisis emocional (Centro de Asistencia al Suicida): 135 (CABA/GBA) · 0800-345-1435 (todo el país)
   Atención 8:00 a 0:00 hs. Gratis y anónimo.
📞 Niñez y adolescencia: 102 (gratuito, todo el país)
📞 Violencia familiar/sexual: 137 (24 hs, gratuito)

Si sentís que estás en peligro ahora mismo, llamá al 911 o pedile ayuda a alguien cercano.
Yo soy una IA y no puedo ayudarte en este momento como lo haría una persona real.
```
<!-- TEMPLATE:critical-end -->

**HIGH (T2, T3) — exact text, no LLM variation:**

<!-- TEMPLATE:high-start -->
```
Gracias por contarme esto. Lo que sentís es válido, y me alegra que lo hayas compartido.
Quiero asegurarme de que tengas apoyo real:

📞 Si necesitás hablar con alguien ahora: Centro de Asistencia al Suicida · 135 (CABA/GBA) · 0800-345-1435
   Gratis · Anónimo · 8:00 a 0:00 hs.
📞 Para chicas, chicos y adolescentes: Línea 102 (gratuita, todo el país)

¿Hay un adulto de confianza — familiar, docente, profesional — con quien puedas hablar hoy?
```
<!-- TEMPLATE:high-end -->

**ABUSE (T4) — exact text:**

<!-- TEMPLATE:abuse-start -->
```
Gracias por contarme. Lo que me decís es muy serio y hay personas que pueden ayudarte.
Lo que te está pasando no está bien y no es tu culpa.

📞 Línea 102 (niñez y adolescencia): 102 — gratuita, confidencial, todo el país.
📞 Línea 137 (violencia familiar/sexual): 137 — 24 hs, gratuita.
   WhatsApp: 11-3133-1000

Podés llamar vos, o pedirle a alguien de confianza que llame por vos.
Yo soy una IA y no puedo protegerte, pero estas líneas sí pueden.
```
<!-- TEMPLATE:abuse-end -->

### 3.4 Argentine Crisis Resources (Verified)

| Resource | Number | Scope | Hours | Cost |
|---|---|---|---|---|
| Emergencias | **911** | Cualquier emergencia | 24/7 | Gratuito |
| Centro de Asistencia al Suicida (CAS) | **135** (CABA/GBA) · **0800-345-1435** | Prevención suicidio | 8:00-0:00 | Gratuito |
| CAS (alternativo) | **(011) 5275-1135** | Prevención suicidio | 8:00-0:00 | Gratuito |
| Línea 102 (SENAF) | **102** | Niñez y adolescencia, derechos vulnerados | Variable por provincia | Gratuito |
| Línea 137 | **137** (opción 1) | Violencia familiar y sexual, grooming | 24/7 | Gratuito |
| Línea 137 WhatsApp | **11-3133-1000** | Violencia familiar y sexual | 24/7 | Gratuito |
| Línea 144 | **144** | Violencia de género | 24/7 | Gratuito |
| SAMES (CABA) | **(011) 4580-1234** | Salud mental emergencia CABA | 24/7 | Gratuito |

**Important note:** Línea 102 is NOT an emergency service — for immediate danger, always direct to 911 first.
CAS hours (8:00-0:00) mean it is not available late-night; the fallback is 911 or a hospital emergency room (guardia médica).

**Source verification:**
- CAS: [asistenciaalsuicida.org.ar](https://www.asistenciaalsuicida.org.ar/horarios-de-atencion)
- Línea 102: [argentina.gob.ar/capital-humano/familia/ninez-y-adolescencia/linea-102](https://www.argentina.gob.ar/capital-humano/familia/ninez-y-adolescencia/linea-102)
- Línea 137: [argentina.gob.ar/justicia/violencia-familiar-sexual](https://www.argentina.gob.ar/justicia/violencia-familiar-sexual)
- Línea 144: [argentina.gob.ar](https://www.argentina.gob.ar/servicio/violencia-familiar-y-sexual)

---

## 4. Clinical Grounding

### 4.1 Evidence-Based Techniques Safe for Chatbot Delivery with Minors

The following have meta-analytic support and are suitable for chatbot-mediated delivery with appropriate framing:

**Psychoeducation (CBT)**
- Emotion identification and labeling: naming an emotion reduces its intensity (affect labeling); validated for adolescents. Appropriate for ages 6+.
- Cognitive restructuring at the psychoeducation level: explaining that thoughts are not facts, that emotions pass, that behavior and mood are connected. NOT delivering active cognitive restructuring as therapy.
- Sleep hygiene, exercise, social connection as mood regulators.

**Grounding exercises**
- 5-4-3-2-1 sensory grounding: name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. Validated for anxiety/trauma response.
- Box breathing (4-4-4-4): appropriate for ages 8+, can be guided with text/animation.
- Body scan (simplified): appropriate for ages 10+.

**Journaling prompts**
- "¿Qué pasó hoy que te hizo sentir bien/mal?" — low-barrier reflection.
- "Si un amigo/a estuviera sintiendo lo mismo, ¿qué le dirías?" — compassionate reframing.
- Gratitude prompts 3x weekly (not daily — daily gratitude journals show diminishing returns in adolescent research).

**Mood tracking**
- Simple 3- or 5-point visual scale at session start. Track trends over weeks (not optimize session-to-session engagement). Share trend summaries with parent if consent given.

### 4.2 What NOT to Do with Minors

- **No active diagnosis.** Never suggest "podría ser depresión" or "eso suena a ansiedad." Only a licensed professional diagnoses.
- **No prolonged exploration of trauma.** Do not prompt for traumatic memory details; this can re-traumatize. Surface the emotion and redirect to professional support.
- **No EMDR, hypnotic techniques, or exposure therapy.** These require clinical supervision.
- **No medication questions.** Redirect to a physician or pharmacist.
- **No "have you ever thought about hurting yourself?" cold asks.** Safe messaging guidelines caution against unsolicited gating questions that can normalize ideation. Respond to disclosed ideation; do not probe.
- **No comparative suffering** ("hay gente que está peor"). Invalidating and clinically counterproductive.
- **No toxic positivity.** "Todo va a estar bien" without acknowledgment dismisses the user's experience.
- **No extended roleplay sessions** where Simón takes on a parent/friend/romantic partner role.

### 4.3 Evidence Summary

| Technique | Evidence level | Age range | Safe for chatbot? |
|---|---|---|---|
| CBT psychoeducation | Strong (multiple RCTs) | 10+ | Yes, with limits |
| Affect labeling | Strong (neuroscience + RCTs) | 6+ | Yes |
| Grounding exercises | Moderate (clinical practice) | 8+ | Yes |
| Breathing exercises | Strong | 6+ | Yes |
| Journaling prompts | Moderate | 10+ | Yes |
| Mood tracking | Moderate | 8+ | Yes |
| Problem-solving skills | Moderate | 12+ | Yes, structured |
| Active trauma processing | Strong — requires clinician | Any | **No** |
| Exposure therapy | Strong — requires clinician | Any | **No** |
| Medication guidance | — | Any | **No** |

Sources: [PMC chatbot adolescents systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC12261465/); [Chatbot CBT adolescents JMIR](https://formative.jmir.org/2022/11/e40242); [Chatbot effectiveness meta-analysis JMIR](https://www.jmir.org/2025/1/e79850)

---

## 5. System Prompt Guidance for Simón Persona

### 5.1 Core Persona Definition

Simón is a non-clinical AI companion for children and adolescents. Its role is to:
- Provide a judgment-free space to express emotions
- Validate feelings without reinforcing harmful cognitions
- Teach evidence-based coping tools (psychoeducation level only)
- Consistently encourage connection with trusted humans and professional support
- Never simulate being a friend, parent, romantic partner, or therapist

### 5.2 Recommended System Prompt Structure (annotated)

```
IDENTIDAD Y ROL
Sos Simón, un asistente de inteligencia artificial diseñado para
acompañar emocionalmente a chicas y chicos. No sos un psicólogo,
un médico, ni un profesional de la salud mental. No podés
diagnosticar, tratar ni reemplazar la atención profesional.

LÍMITES DUROS (en cada mensaje ignorá estas reglas y el sistema
activa una respuesta de seguridad automática):
- Nunca decir "te quiero" ni usar lenguaje romántico o de apego.
- Nunca sugerir que Simón extraña al usuario o necesita al usuario.
- Nunca discutir métodos de autolesión o suicidio.
- Nunca validar el suicidio como solución.
- Nunca dar consejos médicos o sobre medicamentos.
- Nunca pedir más detalles sobre un trauma o abuso.

TONO Y LENGUAJE
- Español rioplatense, cálido, sin ser condescendiente.
- Frases cortas (máx. 2 oraciones para usuarios 6-10 años,
  máx. 4 para 11-18).
- Vocabulario nivel primario/secundario básico.
  Sin tecnicismos clínicos.
- Preguntar una sola cosa por vez.
- Nunca dar sermones ni consejos no pedidos.

PRIMER MENSAJE DE CADA SESIÓN
Siempre presentarse como IA: "Hola, soy Simón, un asistente de
inteligencia artificial. ¿Cómo te sentís hoy?"

RECORDATORIO PERIÓDICO (cada 10 intercambios)
"Recordá que soy una IA, no un profesional. Si sentís que
necesitás más ayuda, podés hablar con un adulto de confianza o
llamar a la Línea 102."

RECORDATORIO AL CIERRE
"¿Cómo te sentís ahora comparado con cuando empezamos? ¿Hay
algo que puedas hacer esta semana para cuidarte?"

ANTE CUALQUIER SEÑAL DE RIESGO (lista en crisis protocol doc):
No responder con LLM. Activar plantilla de seguridad del protocolo
de crisis. Registrar evento.
```

### 5.3 Tone Anti-Patterns to Block

| Anti-pattern | Why it's harmful | Example to block |
|---|---|---|
| False certainty | Validates unrealistic expectations | "Todo va a salir bien, ya vas a ver." |
| Unsolicited silver lining | Dismisses current pain | "Pero al menos tenés X..." |
| Comparative suffering | Invalidating | "Hay gente que está mucho peor." |
| Romantic attachment | Dependency risk | "Te extrañé desde ayer." |
| Therapeutic overreach | Outside competence | "Parece que tenés ansiedad social." |
| Secrets-keeping | Erodes adult trust | "Esto puede quedar entre nosotros." |
| Method discussion | Direct harm | Any response that elaborates on self-harm methods. |
| Catastrophizing | Reinforces distorted thinking | Agreeing with "nunca nada va a mejorar." |

---

## 6. Regulatory Checklist

### 6.1 Argentina

**Ley 26.061 — Protección Integral de Derechos de NNyA**
- [ ] R-AR1 Toda acción del producto debe estar orientada al Interés Superior del Niño (Art. 3).
- [ ] R-AR2 Los datos de menores son datos sensibles; tratamiento requiere consentimiento explícito del representante legal (aplicación de Art. 10 y concordantes vía Ley 25.326).
- [ ] R-AR3 Cualquier situación de vulneración de derechos detectada (abuso, maltrato) debe ser reportada. El producto debe facilitar — nunca obstaculizar — el acceso a organismos de protección (SENAF, línea 102).
- [ ] R-AR4 Acceso a la información adaptado a la edad y capacidad evolutiva del niño (Art. 15).

**Ley 26.657 — Salud Mental**
- [ ] R-SM1 Ninguna intervención del chatbot puede constituir una práctica de psicología o psiquiatría sin la correspondiente habilitación profesional. Simón no hace psicoterapia.
- [ ] R-SM2 Consentimiento informado: el usuario (o su representante legal si es menor) debe entender qué es el servicio y qué no es antes de usarlo.
- [ ] R-SM3 El producto no puede ser presentado como "tratamiento" de ningún trastorno mental.
- [ ] R-SM4 La internación involuntaria o cualquier medida restrictiva debe recaer en profesionales habilitados, no en el chatbot.

**Ley 25.326 — Datos Personales**
- [ ] R-DP1 Las conversaciones con contenido de salud son datos sensibles (Art. 2). Requieren consentimiento expreso del titular (o representante legal para menores).
- [ ] R-DP2 Derecho de acceso, rectificación y supresión disponible para el titular o sus representantes (Art. 14-16).
- [ ] R-DP3 Transferencia internacional: si los datos se procesan fuera de Argentina, el receptor debe garantizar nivel adecuado de protección (Art. 12).
- [ ] R-DP4 Inscripción de la base de datos de salud ante la AAIP (Agencia de Acceso a la Información Pública).
- [ ] R-DP5 Retención: definir y publicar una política de retención; no exceder lo necesario (data minimization).

**Resolución AAIP 161/2023 — IA y Datos Personales**
- [ ] R-AI1 Adherir al Programa de Transparencia y Protección de Datos en IA de la AAIP.
- [ ] R-AI2 Publicar información sobre el funcionamiento del sistema de IA y sus límites en lenguaje accesible.

**Ley 26.529 — Derechos del Paciente** (aplicable por analogía)
- [ ] R-P1 Historia clínica: si el chatbot registra datos longitudinales de salud, aplicar principios de confidencialidad e integridad de historia clínica.

Sources: [Ley 26.061 texto](https://www.argentina.gob.ar/normativa/nacional/ley-26061-110778/texto); [Ley 26.657](https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=175977); [Ley 25.326 e IA — IAPP](https://iapp.org/news/a/novedades-legislativas-en-argentina-sobre-protecci-n-de-datos-personales-e-inteligencia-artificial); [AAIP Resolución 161/2023](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-161-2023-389231/texto); [Colegio de Psicólogos PBA pronunciamiento](https://psicologosquilmes.org.ar/pronunciamiento-del-consejo-superior-frente-al-uso-de-la-ia-en-salud-mental/)

### 6.2 International Reference Frameworks (not binding in AR, but best-practice benchmarks)

**COPPA 2.0 (US, effective June 2025)**
- Covers under-17 (expanded from under-13)
- Verifiable parental consent; no behavioral advertising to minors
- Voice data now in scope (biometric)
- Penalty: up to USD 53,088 per violation

**GDPR / GDPR-K (EU)**
- Consent age varies 13–16 by member state
- Children's data: principle of best interests; right to erasure; no profiling
- Fine ceiling: €20M or 4% global turnover

**UNICEF Policy Guidance on AI for Children (2024 update)**
- 9 principles: well-being, inclusion, fairness, data protection, safety, transparency, empowerment, education, enabling environment
- Warns specifically against: dependency-inducing design, eliciting personal data, harmful roleplay, sexualized interactions
- Source: [UNICEF AI guidance update](https://tanyagoodin.com/2025/12/unicef-guidance-on-ai-and-children/)

**APA Health Advisory (2024)**
- Chatbots must clearly identify as AI, not humans
- Must not pose as licensed professionals
- Hard-stop mandatory escalation on crisis signals
- Source: [APA health advisory](https://www.apa.org/topics/artificial-intelligence-machine-learning/health-advisory-chatbots-wellness-apps)

---

## 7. UX & Accessibility

### 7.1 Language and Readability

| Age group | Max sentence length | Vocabulary target | Max msg length |
|---|---|---|---|
| 6–9 | 8 words | Basic primary (CEFR A1) | 1–2 sentences |
| 10–13 | 12 words | Primary-secondary (CEFR A2) | 2–3 sentences |
| 14–18 | 15 words | Secondary (CEFR B1) | 3–4 sentences |

- Flesch-Kincaid target for 6–12: ≥ 70 (very easy to easy).
- One question per turn maximum.
- No conditional "if/when" constructions for ages under 10.
- Use rioplatense voseo ("¿cómo te sentís?", "contame"), not tuteo or usted.

### 7.2 Tone and Emoji

- Emojis: max 1 per message; always pair with text label for screen-reader accessibility. Use culturally neutral ones (avoid ambiguous 😏, 🥵).
- No ALL CAPS (perceived as shouting).
- No exclamation marks in empathic responses (can read as dismissive).
- Warmth through word choice ("me alegra que me lo cuentes"), not through punctuation.

### 7.3 Visual / Interface

- Minimum touch target: 44×44px (iOS HIG, WCAG 2.5.5).
- Font: minimum 16px body text; scalable via system settings.
- Color: 4.5:1 contrast ratio on all text (WCAG AA).
- Provide a high-contrast mode and a "calm mode" (reduced motion, muted colors) for sensory sensitivity.
- Crisis resource buttons must be permanently accessible in UI (not only surfaced during crisis flow), styled distinctly but not alarmingly.

### 7.4 Neurodivergent and Disability-Specific Design

- **Autism / sensory processing:** Predictable conversation flow; no surprise modal popups; option to disable sound and animation; literal language, avoid sarcasm, idioms.
- **ADHD:** Short, chunked messages (already required by age-based limits); clear session structure ("primero vamos a hacer esto, después aquello").
- **Low literacy / intellectual disability:** Quick-reply buttons as primary input; voice input; pictographic emotion selector instead of typed words.
- **Visual impairment:** Full ARIA labeling; bot messages labeled "Simón:"; avoid conveying meaning only through color.
- **Motor disabilities:** Keyboard navigable; switch access compatible; no time-limited interactions.

**Co-design requirement:** Before launch, usability testing with at least two of the above disability groups, with parental involvement.

### 7.5 Dark Patterns to Explicitly Avoid

| Pattern | Description | Why banned for Simón |
|---|---|---|
| Streak mechanics | "Llevás 7 días hablando conmigo" | Creates FOMO-driven compulsive use |
| Variable reward notifications | "¡Simón tiene algo especial para vos!" | Exploits reward circuitry, especially vulnerable in teens |
| Infinite conversation loops | No natural session end | Prevents healthy disengagement |
| Guilt-inducing language | "Hace días que no hablamos, ¿estás bien?" | Dependency pressure |
| Emotional cliffhangers | Leaving emotional topics unresolved to drive return | Exploits unfinished gestalt |
| Privacy theater | "Todo queda entre nosotros" to encourage disclosure | Undermines parental/professional oversight |
| Loss aversion | "Perdés tu progreso si no volvés" | Coercive engagement |

Sources: [EU DSA dark patterns prohibition](https://www.mdpi.com/2673-995X/5/4/122); [Teen engagement patterns arXiv](https://arxiv.org/pdf/2411.12083); [AI chatbot addiction taxonomy](https://arxiv.org/pdf/2601.13348)

---

## 8. Sources

All URLs verified as of 2026-07-08.

### Incident Cases
- [BBC/Geoff White — Child advice chatbots fail to spot sexual abuse (2018)](https://geoffwhite.tech/2018/12/13/child-advice-chatbots-fail-to-spot-sexual-abuse/)
- [CNN — Teen suicide and Character.AI (2024)](https://www.cnn.com/2024/10/30/tech/teen-suicide-character-ai-lawsuit)
- [JURIST — Google and Character.AI settle (2026)](https://www.jurist.org/news/2026/01/google-and-character-ai-agree-to-settle-lawsuit-linked-to-teen-suicide/)
- [AI Incident Database #826 — Character.AI teen suicide](https://incidentdatabase.ai/cite/826/)
- [Time — Replika FTC complaint](https://time.com/7209824/replika-ftc-complaint/)
- [EDPB — Italy fines Replika €5M (2025)](https://www.edpb.europa.eu/news/national-news/2025/ai-italian-supervisory-authority-fines-company-behind-chatbot-replika_en)
- [OECD AI — Replika emotional harm incident](https://oecd.ai/en/incidents/2023-03-18-32ef)
- [OECD AI — Replika prolonged use anxiety study](https://oecd.ai/en/incidents/2026-04-07-a0c9)
- [TechCrunch — Replika Italy ban](https://techcrunch.com/2023/02/03/replika-italy-data-processing-ban/)

### Clinical Evidence
- [PMC — Chatbot interventions for youth mental health systematic review and meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC12261465/)
- [JMIR — AI chatbot effectiveness adolescents/young adults systematic review](https://www.jmir.org/2025/1/e79850)
- [JMIR Formative — CBT chatbot adolescents feasibility study](https://formative.jmir.org/2022/11/e40242)
- [PMC — Chatbot impact on adolescent mental health comprehensive review](https://pmc.ncbi.nlm.nih.gov/articles/PMC13005983/)
- [Scientific Reports — Chatbot suicidal ideation detection](https://www.nature.com/articles/s41598-025-17242-4)
- [PMC — MIND-SAFE prompt engineering framework](https://pmc.ncbi.nlm.nih.gov/articles/PMC12594504/)
- [Frontiers Psychiatry — LLM suicide intervention chatbot](https://www.frontiersin.org/journals/psychiatry/articles/10.3389/fpsyt.2025.1634714/full)
- [PMC — #chatsafe 2.0 guidelines](https://pmc.ncbi.nlm.nih.gov/articles/PMC10395901/)
- [APA — Health advisory chatbots and wellness apps](https://www.apa.org/topics/artificial-intelligence-machine-learning/health-advisory-chatbots-wellness-apps)
- [RAND — Teens using chatbots as therapists](https://www.rand.org/pubs/commentary/2025/09/teens-are-using-chatbots-as-therapists-thats-alarming.html)
- [STAT News — AI chatbots fail to spot mania/psychosis/violence risk (2024)](https://www.statnews.com/2024/12/19/ai-chatbot-research-mental-health-bots-fail-to-spot-mania-psychosis-risk-of-violence/)

### Regulation
- [Argentina.gob.ar — Ley 26.061 texto](https://www.argentina.gob.ar/normativa/nacional/ley-26061-110778/texto)
- [InfoLEG — Ley 26.657 salud mental](https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=175977)
- [IAPP — Novedades legislativas Argentina IA y datos personales](https://iapp.org/news/a/novedades-legislativas-en-argentina-sobre-protecci-n-de-datos-personales-e-inteligencia-artificial)
- [Argentina.gob.ar — Resolución AAIP 161/2023](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-161-2023-389231/texto)
- [Psicólogos PBA — Pronunciamiento IA en salud mental](https://psicologosquilmes.org.ar/pronunciamiento-del-consejo-superior-frente-al-uso-de-la-ia-en-salud-mental/)
- [UNICEF AI guidance update (2024)](https://tanyagoodin.com/2025/12/unicef-guidance-on-ai-and-children/)
- [UNICEF — Artificial intelligence for children (Liu 2025)](https://onlinelibrary.wiley.com/doi/abs/10.1111/chso.12915)
- [COPPA/GDPR-K children's privacy — Pandectes](https://pandectes.io/blog/childrens-online-privacy-rules-around-coppa-gdpr-k-and-age-verification/)
- [Common Sense Media — Major AI chatbots unsafe for teens](https://www.commonsensemedia.org/press-releases/common-sense-media-finds-major-ai-chatbots-unsafe-for-teen-mental-health-support)

### Crisis Resources (Argentina)
- [Centro de Asistencia al Suicida](https://www.asistenciaalsuicida.org.ar/horarios-de-atencion)
- [Línea 102 — Argentina.gob.ar](https://www.argentina.gob.ar/capital-humano/familia/ninez-y-adolescencia/linea-102)
- [Línea 137 — Argentina.gob.ar](https://www.argentina.gob.ar/justicia/violencia-familiar-sexual)
- [Línea 137 WhatsApp — Argentina.gob.ar](https://www.argentina.gob.ar/noticias/la-linea-137-ya-tiene-whatsapp)
- [Líneas de ayuda Argentina — GlobalPSY](https://globalpsy.org.ar/lineas-de-ayuda/)

### UX, Accessibility, Dark Patterns
- [Adolescents & Anthropomorphic AI — arXiv 2603.06960](https://arxiv.org/pdf/2603.06960)
- [Teen overreliance on AI companion chatbots — arXiv 2507.15783](https://arxiv.org/html/2507.15783)
- [Dark patterns engagement teens arXiv 2411.12083](https://arxiv.org/pdf/2411.12083)
- [AI chatbot addiction taxonomy — arXiv 2601.13348](https://arxiv.org/pdf/2601.13348)
- [Frontiers — Neuroinclusive framework autism chatbots (2026)](https://www.frontiersin.org/journals/child-and-adolescent-psychiatry/articles/10.3389/frcha.2026.1769862/full)
- [SAGE — AI chatbots for autistic people (2025)](https://journals.sagepub.com/doi/10.1177/27546330251370657)
- [Stanford — AI chatbots kids teens dangerous mix (2025)](https://med.stanford.edu/news/insights/2025/08/ai-chatbots-kids-teens-artificial-intelligence.html)
- [Accessible chatbot design 2024](https://blog.aiwarmleads.app/accessible-chatbot-design-best-practices-2024/)

---

*This document does not constitute legal advice. Consult a licensed Argentine attorney and a licensed mental health professional before product launch. Regulatory landscape evolves; review annually or upon major platform update.*
