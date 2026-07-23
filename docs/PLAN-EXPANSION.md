# Simón AI — Plan de expansión (4 features de alto impacto social)

> Fecha: 2026-07-09 · Estado: **PROPUESTA HISTÓRICA, IMPLEMENTADA EN 4 FASES** (`23ccd5f`, `32eb14d`, `851924d`, `da6046d`). Usar [`propuesta-tecnica-2026-07.md`](propuesta-tecnica-2026-07.md) para alcance institucional y gaps vigentes.
> Basado en: [ARCHITECTURE.md](ARCHITECTURE.md), [research-safety.md](research-safety.md), [research-guardian.md](research-guardian.md)
> Contexto regional (investigado 2026-07): el Servicio de Salud Mental del Hospital Provincial de Neuquén **no toma nuevos pacientes ambulatorios desde ~10 meses** por falta de personal; Río Negro está desbordado (257 psicólogos / 65 psiquiatras para toda la provincia). Las apps para adolescentes son casi todas extranjeras (Woebot cerró, Wysa, Character.AI). **No existe en Neuquén/Río Negro un producto tutor-first, con eje discapacidad y seguridad multicapa como Simón.**

---

## 0. Tesis (leer primero)

El camino "IA que hace de psicólogo" es a la vez el **más peligroso** (casos Character.AI/Replika, ver research-safety §1) y el **menos defendible** legalmente (Ley 26.657). La ventaja real de Simón —y lo que lo vuelve pionero— es ser **la capa que conecta a las familias con el sistema real (colapsado e imposible de navegar) y les da herramientas concretas mientras esperan**.

Las 4 features elegidas forman un **arco coherente**, no features sueltas:

```
  EL CHICO/A                    SIMÓN DETECTA               LA FAMILIA ACCEDE
  se expresa y se regula   →    un patrón y hace      →     a ayuda real y
  (Kit de calma + Diario)       de puente (Puente)          derechos (Cerca tuyo + Trámites)
```

| # | Feature | Para quién | Qué resuelve | Impacto |
|---|---------|-----------|--------------|---------|
| 1 | **Cerca tuyo** — directorio de recursos reales georreferenciado | Chico + Tutor | Las líneas nacionales no alcanzan cuando el hospital no atiende: hay que decir *a dónde ir acá* | 🔴 Crítico |
| 2 | **Mis trámites** — asistente guiado (CUD, pensión, transporte, escolaridad) | Tutor | El laberinto de discapacidad agota a las familias; en el interior es peor | 🔴 Diferenciador |
| 3 | **Puente** — derivación asistida (warm handoff) | Tutor | Cierra la brecha entre "Simón detectó algo" y "la familia hizo algo" | 🟠 Alto |
| 4 | **Kit de calma + Mi diario** — autorregulación y registro emocional | Chico | Herramientas evidence-based *ahora*, mientras todo el sistema está en lista de espera | 🟠 Alto |

Todo respeta los límites no negociables de research-safety: Simón **no diagnostica, no hace terapia, no reemplaza**. Estas features **derivan y acompañan**, no tratan.

---

## 1. Arquitectura de información (la "ubicación inteligente")

El principio: **el chico ve lo mínimo (una sola cosa a la vez); el tutor tiene todo, agrupado en 3 hubs claros.** No sumamos 6 ítems de nav planos —eso abruma—: reorganizamos en 3 destinos con sub-secciones.

### 1.1 Superficie del CHICO/A (rol `child`) — minimalismo y seguridad

Hoy el chico solo ve **Chat** (la bottom-nav no se renderiza con 1 ítem). Se mantiene así. Las herramientas se **tejen en el flujo natural**, no como pestañas nuevas:

- **Barra de acciones siempre visible** encima del input del chat, con 2 botones grandes (≥44px, WCAG):
  - **🫧 Calma** → abre el *Kit de calma* (ejercicios interactivos).
  - **🆘 Ayuda ahora** → abre una hoja con líneas de crisis + recursos cercanos (subconjunto seguro de *Cerca tuyo*). Cumple research-safety §7.3 ("crisis resources permanently accessible").
- **Al abrir una conversación nueva:** mini check-in de ánimo (3 caritas, 1 toque) → alimenta *Mi diario*.
- **Al cerrar sesión de chat:** check-out de ánimo + 1 sugerencia del mundo real (research-safety SH-C3).
- **Mi diario:** acceso suave desde un ícono en el header del chat (no es nav pesada).

El chico **nunca** ve trámites, directorio de administración, ni el Puente. Su mundo es hablar + calmarse + registrarse.

### 1.2 Superficie del TUTOR/A (rol `guardian`) — 3 hubs

Nav actual: `Chat · Aprender · Tutor`. Nav propuesta (mismo número de ítems, más ricos):

```
Chat        →  (sin cambios) hablar con Simón
Ayuda       →  hub con 3 pestañas:  Cerca tuyo · Trámites · Aprender(fichas)
Familia     →  hub del tutor:       Puente · Bienestar(ánimo+temas) · Menores(panel actual)
```

- **Ayuda** (evoluciona `/aprender`): todo lo de "navegar el mundo real" en un solo lugar.
- **Familia** (evoluciona `/tutor`): supervisión + acción. El panel actual (alta/alertas/baja) queda como pestaña "Menores".

Implementación de nav: extender `NAV_ITEMS` en [site-header.tsx](../simon/src/components/site-header.tsx) (renombrar labels/rutas, agregar sub-nav por pestañas dentro de cada hub). `visibleNavItems(role)` ya filtra por rol — se mantiene.

### 1.3 Mapa de rutas propuesto

| Ruta | Rol | Feature | Estado |
|------|-----|---------|--------|
| `/` | ambos | Chat + barra Calma/Ayuda + check-in | extender |
| `/diario` | child | Mi diario (tendencia propia) | nuevo |
| `/ayuda` | guardian | hub → default: Cerca tuyo | nuevo (o rename de `/aprender`) |
| `/ayuda/cerca` | guardian | Cerca tuyo (directorio) | nuevo |
| `/ayuda/tramites` | guardian | lista de trámites | nuevo |
| `/ayuda/tramites/[slug]` | guardian | wizard de un trámite | nuevo |
| `/ayuda/aprender` | guardian | fichas (learn-explorer actual) | mover |
| `/familia` | guardian | hub → default: Puente | nuevo (o rename de `/tutor`) |
| `/familia/menores` | guardian | panel actual (tutor-panel) | mover |

---

## 2. Feature 1 — "Cerca tuyo" (directorio de recursos reales)

**Objetivo:** cuando hay crisis o la familia necesita ayuda, mostrar recursos **reales, locales y accionables** (no solo líneas nacionales). Es lo que llena el vacío del sistema colapsado.

### 2.1 Modelo de datos (nuevo)

```prisma
model HelpResource {
  id           String   @id @default(cuid())
  name         String
  // "crisis" | "salud_mental" | "discapacidad" | "escuela" | "linea" | "ong"
  kind         String
  // "neuquen" | "rionegro" | "nacional"
  province     String
  localidad    String?          // "Neuquén capital", "Cipolletti", "Bariloche"...
  address      String?
  lat          Float?
  lng          Float?
  phone        String?
  whatsapp     String?
  hours        String?          // "Lun a Vie 8–20", "24 hs"
  cost         String           // "gratis" | "obra_social" | "arancel"
  takesChildren Boolean @default(true)
  noAppointment Boolean @default(false)  // atiende sin turno / guardia
  url          String?
  notes        String?
  source       String?          // organismo que respalda el dato
  reviewed     Boolean  @default(false)  // validado por una persona
  active       Boolean  @default(true)
  updatedAt    DateTime @updatedAt

  @@index([province, kind])
}
```

**Ubicación del dato de provincia de la familia:** agregar `province String?` y `localidad String?` al modelo `Guardian` (se setea en el alta del menor, [tutor-panel.tsx](../simon/src/components/tutor-panel.tsx)). Así el directorio y la plantilla de crisis se filtran por la zona correcta.

**Seed inicial:** líneas nacionales verificadas (135, 0800-345-1435, 102, 137, 144, 911 — ya en research-safety §3.4) + recursos de Neuquén/Río Negro (hospitales, CeSAC, ONGs, juntas evaluadoras). Todos `reviewed: false` hasta validación humana.

### 2.2 Backend

- `GET /api/resources?province=&kind=&localidad=&q=` — devuelve recursos `active && reviewed`, filtrados. Auth requerida (chico y tutor). Para el chico, la hoja "Ayuda ahora" pide `kind=crisis,linea` + los más cercanos (subconjunto curado). Dato **no sensible** (directorio público) → sin restricciones de privacidad especiales, pero autenticado.

### 2.3 Lógica de punta a punta

**Flujo A — El tutor explora (`/ayuda/cerca`):**
1. Entra al hub Ayuda → pestaña Cerca tuyo.
2. Se pre-filtra por `Guardian.province`. Chips de filtro: "Atiende niñez", "Sin turno", "Gratis", por localidad.
3. Lista de tarjetas: nombre, tipo, distancia (si hay lat/lng), horario, teléfono con botón "Llamar" y "WhatsApp". Mapa opcional (fase 2).
4. Cada tarjeta enlaza al Puente ("¿Contactaste este lugar?") y a los Trámites relevantes.

**Flujo B — Enriquecimiento de la plantilla de crisis (el gran salto):**
La capa de safety ([safety.ts](../simon/src/lib/safety.ts)) hoy devuelve plantillas nacionales **exactas, sin LLM**. Se le agrega un bloque **también determinístico** (sin LLM, sin romper la garantía de research-safety §M-S2):
1. Safety detecta crisis (sin cambios).
2. Arma la plantilla nacional hardcodeada (sin cambios).
3. **NUEVO:** busca `province` del chico (vía `Guardian` de ese `childUserId`) → trae 1–2 `HelpResource` de `kind=crisis` `reviewed=true` de esa provincia → **agrega un bloque fijo** ("Y cerca tuyo: Hospital X — guardia 24 hs — tel …"). Si no hay ninguno, queda solo la nacional (degradación elegante).
4. Devuelve. **Sigue siendo 100% determinístico, sin LLM, testeable** (extender `crisis-suite`).

**Flujo C — El chico toca "🆘 Ayuda ahora":**
Abre una hoja simple con las líneas de crisis (grandes, con botón llamar) + 2–3 recursos cercanos. Siempre accesible, sin fricción.

### 2.4 Estados de UI
- **Vacío** (provincia sin recursos cargados aún): "Estamos sumando lugares de tu zona. Mientras tanto, estas líneas atienden en todo el país: …" + nacionales.
- **Error de red:** cae a las líneas nacionales hardcodeadas (nunca deja al usuario sin recursos).

---

## 3. Feature 2 — "Mis trámites" (asistente guiado)

**Objetivo:** convertir las fichas estáticas de `/aprender` en un **asistente con estado** que guía paso a paso los trámites de discapacidad. El diferenciador imbatible.

### 3.1 Modelo de datos (nuevo)

```prisma
// Plantilla del trámite (contenido, versionable, validable por profesional)
model TramiteGuide {
  id          String   @id @default(cuid())
  slug        String   @unique
  title       String
  summary     String
  // "cud" | "pension" | "transporte" | "escolaridad" | "salud"
  category    String
  province    String?          // null = nacional; o variante provincial
  estimatedTime String?        // "2 a 4 semanas"
  requirements Json            // [{ label, detail?, optional? }]
  steps        Json            // [{ title, detail, where?, resourceKind?, link? }]
  reviewed     Boolean @default(false)
  updatedAt    DateTime @updatedAt
}

// Progreso por familia (con estado — esto lo vuelve "asistente", no "biblioteca")
model TramiteProgress {
  id             String   @id @default(cuid())
  guardianUserId String
  childUserId    String?          // opcional: para qué menor
  guideSlug      String
  status         String   @default("in_progress") // in_progress | done | dismissed
  currentStep    Int      @default(0)
  checkedItems   Json     @default("[]")           // índices de requisitos tildados
  startedAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([guardianUserId, childUserId, guideSlug])
  @@index([guardianUserId])
}
```

### 3.2 Backend
- `GET /api/tramites?category=&province=` — lista de guías (solo `reviewed=true` en prod).
- `GET /api/tramites/[slug]` — guía completa + progreso de esta familia (join con `TramiteProgress`).
- `POST /api/tramites/[slug]/progress` — actualiza `currentStep` / `checkedItems` / `status`. Solo `guardian`, validado con zod, **update inmutable** (nuevo objeto, nunca mutación in-place, per coding-style).
- Todo **guardian-only** (el trámite es tarea del adulto).

### 3.3 Lógica de punta a punta
1. Tutor entra a `/ayuda/tramites` → ve guías filtradas por el diagnóstico del menor (categoría de las fichas) y su provincia.
2. Abre "Certificado Único de Discapacidad (CUD)".
3. El wizard muestra: qué es, quién califica, **checklist de documentos** (tildables, se persisten), **pasos ordenados** con "dónde ir" (link directo a la junta evaluadora en *Cerca tuyo*), tiempos estimados, plazos.
4. El progreso persiste. Al volver: "Seguí donde quedaste: Paso 3 de 6."
5. Al terminar: `status=done` + sugerencia del siguiente trámite lógico (ej: sacado el CUD → "pensión no contributiva" / "transporte").

### 3.4 Cross-links
- Desde una ficha de `/aprender`: botón "¿Te guío con este trámite?" → abre la guía.
- Desde el chat (el tutor también puede chatear): Simón puede deep-linkear a la guía.

### 3.5 Estados de UI
- **Sin trámites empezados:** tarjetas de guías con un CTA claro "Empezar".
- **En progreso:** anillo de progreso ("Paso 2 de 6") en cada tarjeta.
- **Guía sin validar:** badge "En revisión" (igual que las fichas hoy con `reviewed:false`).

---

## 4. Feature 3 — "Puente" (derivación asistida / warm handoff)

**Objetivo:** conectar la **detección** de Simón (los `SafetyEvent` a lo largo del tiempo) con una **acción concreta** para el tutor. Es el corazón de la tesis "puente al sistema real". Reutiliza datos que **ya se registran**.

### 4.1 Modelo de datos
- Reutiliza `SafetyEvent` (ya existe: `category`, `layer`, `createdAt`, `notifiedAt`). **Anonimizado: nunca guarda contenido** — clave para no violar M-P2 (el tutor ve temas, no transcripciones).
- Nuevo modelo liviano de seguimiento:

```prisma
model GuardianFollowup {
  id             String   @id @default(cuid())
  guardianUserId String
  childUserId    String
  // Motivo agregado: "crisis" | "riesgo" | "abuso" | "alimentario" | "patron"
  reason         String
  status         String   @default("suggested") // suggested | contacted | resolved | dismissed
  resourceId     String?          // HelpResource que el tutor eligió contactar
  note           String?          // nota corta del tutor (sin PII del chico)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([guardianUserId, status])
}
```

### 4.2 Backend
- `GET /api/guardian/bridge` — computa y devuelve:
  - **Sugerencias activas:** derivadas de agregados de `SafetyEvent` (ej: ≥2 eventos `riesgo` en 14 días, o cualquier `crisis`). Sin contenido de mensajes.
  - **Seguimientos abiertos** (`GuardianFollowup` con `status != resolved/dismissed`).
- `POST /api/guardian/bridge/[id]` — actualiza `status` / `resourceId` / `note`. Guardian-only, validado.

### 4.3 Lógica de punta a punta
1. Simón registra `SafetyEvent` (ya pasa hoy) + manda alerta por email si `alertsEnabled` (ya pasa hoy, dedupe 1h en [alerts.ts](../simon/src/lib/alerts.ts)).
2. El endpoint del Puente detecta un **patrón** (regla determinística sobre agregados; nada de LLM sobre datos del chico).
3. En `/familia` (pestaña Puente) aparece una tarjeta **calma pero visible**:
   - "Simón notó **[señal]** varias veces en las últimas 2 semanas."
   - **Próximo paso concreto:** el recurso de *Cerca tuyo* que corresponde (ej: Línea 102 / hospital local).
   - **"Qué decir para pedir el turno"** (guion breve).
   - **"Cómo hablar con tu hijo/a"** (mini-guía psicoeducativa, nivel permitido).
   - Botones: **"Ya lo contacté"** · **"Recordámelo en 3 días"** · **"Descartar"** → mueven el `GuardianFollowup.status`.
4. El email de alerta de crisis (ya existe) enlaza a esta pantalla.

### 4.4 Privacidad (no negociable)
El Puente muestra **categorías y próximos pasos, nunca transcripciones** (M-P2). El tutor recibe temas + alertas, no vigilancia mensaje a mensaje. Esto respeta la línea de research-safety §1.5 (riesgo de aislar al chico si se lo vigila).

### 4.5 Estados de UI
- **Todo tranquilo:** empty state cálido ("Por ahora no hay señales que requieran un paso extra. Seguimos acompañando.").
- **Sugerencia activa:** 1 tarjeta clara con el próximo paso.
- **Seguimiento en curso:** "Marcaste que contactaste Línea 102 el 3/7. ¿Cómo salió?".

---

## 5. Feature 4 — "Kit de calma" + "Mi diario"

**Objetivo:** darle al chico herramientas reales de autorregulación (respiración, grounding, diario) + registro de ánimo — usables **ahora**, mientras todo está en lista de espera. Psicoeducación validada (research-safety §4), **no** terapia.

### 5.1 Kit de calma (ejercicios interactivos)
Client-side, sin backend obligatorio:
- **Respiración 4-4-4-4** (círculo que se expande/contrae, animado; respeta "reducir movimiento" del modo calma existente [calm-toggle.tsx](../simon/src/components/calm-toggle.tsx)).
- **Grounding 5-4-3-2-1** (paso a paso por los sentidos).
- Accesible: TTS opcional, texto grande, sin dependencia de color.
- (Opcional) log de uso anónimo vía `InteractionLog` para métricas de impacto.

### 5.2 Mi diario (registro de ánimo)

```prisma
model MoodEntry {
  id        String   @id @default(cuid())
  userId    String                       // el chico
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  value     Int                          // 1 = mal · 2 = más o menos · 3 = bien
  // "session_start" | "session_close" | "manual"
  context   String
  note      String?                      // corta, opcional (mismas reglas anti-PII)
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}
```
(Agregar `moods MoodEntry[]` a `User`. TTL alineado con la retención de datos, purga lazy como `UserMemory`/`InteractionLog`.)

### 5.3 Backend
- `POST /api/mood` — el chico registra una entrada (auth, rol `child`, zod). Update inmutable.
- `GET /api/mood` — el chico ve su propia tendencia; el tutor ve el **agregado** de su menor (con consentimiento) → alimenta la pestaña "Bienestar" de *Familia*.
- El Kit de calma es casi todo client-side (sin backend).

### 5.4 Lógica de punta a punta
1. El chico abre una conversación nueva → **check-in** (3 caritas, 1 toque) → `MoodEntry context=session_start`.
2. Chatea normal.
3. A los 45 min (o al cerrar) → **check-out** ("¿Cómo te sentís ahora comparado con cuando empezamos?") → `MoodEntry context=session_close` + 1 sugerencia real (research-safety SH-C3).
4. **Mi diario** (`/diario`): el chico ve su tendencia con lenguaje suave (nunca clínico), no números fríos.
5. El tutor ve la **tendencia** (no las entradas) en *Familia → Bienestar*, junto al Puente.

### 5.5 Anti-adicción (research-safety §7.5 — obligatorio)
Sin rachas, sin badges, sin "Simón te extraña". El diario es reflexión, **no** gamificación de la disclosure emocional.

---

## 6. Orden de construcción (fases, cada una entregable)

| Fase | Feature | Por qué en este orden | Esfuerzo |
|------|---------|----------------------|----------|
| **1** | Cerca tuyo (dir. + enriquecimiento de crisis + botón "Ayuda ahora") | Máximo impacto de seguridad inmediato; es **prerrequisito** del Puente | Medio |
| **2** | Kit de calma + Mi diario | Valor directo al chico, casi todo client-side, independiente | Bajo-medio |
| **3** | Puente (derivación asistida) | Usa `SafetyEvent` (ya existe) + recursos de la Fase 1 | Medio |
| **4** | Mis trámites (guiados) | Diferenciador; el mayor trabajo es **contenido validado** | Medio-alto |

**Gate de cada fase** (per ARCHITECTURE.md §5): `pnpm test && pnpm lint && pnpm build` verde + suite específica (ej: `crisis-suite` extendida para el bloque local en Fase 1).

## 7. Dependencias y pendientes transversales

- **Validación humana:** `HelpResource`, `TramiteGuide` y las fichas arrancan `reviewed:false`. Sin validación profesional/oficial no entran a producción. (Ver ARCHITECTURE.md backlog #6.)
- **Provincia de la familia:** agregar `province`/`localidad` a `Guardian` (alta del menor) — habilita filtrado local en Cerca tuyo, Trámites y el enriquecimiento de crisis.
- **Migraciones Prisma:** 4 modelos nuevos (`HelpResource`, `TramiteGuide`, `TramiteProgress`, `GuardianFollowup`, `MoodEntry`) + 2 campos en `Guardian`. Una migración por fase.
- **Seguridad:** todo endpoint nuevo pasa por auth + validación de rol (guardian vs child) + zod, siguiendo el patrón de `requireGuardian` ya existente.
- **Métricas de impacto (habilitador de financiamiento):** el `MoodEntry` (inicio/cierre) + agregados de Puente permiten un tablero anonimizado para pedir financiamiento provincial/municipal — la llave para que sea gratis para las familias.
