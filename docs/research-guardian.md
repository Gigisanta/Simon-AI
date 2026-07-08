# Simón AI — Research: Consentimiento del tutor, better-auth y email transaccional

**Scope:** M-P1/M-P2/M-P3 de [research-safety.md §2.1](research-safety.md) — consentimiento verificable de tutor antes de que el menor use el chat, alerta de crisis al tutor, resumen semanal (nunca transcripciones por defecto). Insumo para [ARCHITECTURE.md §5 Fase 1](ARCHITECTURE.md) (modelo `Guardian` ⬜, tabla `SafetyEvent` ⬜).
**Stack confirmado en repo:** Next.js 16.2.10, better-auth 1.6.23 (email/password, sin plugins adicionales hoy), Prisma 7.8.0, `User` sin campo `role` todavía.
**Fecha:** 2026-07-08.

---

## 1. Flujo de consentimiento parental verificable (patrones 2026)

### 1.1 Qué exige COPPA 2026 como referencia (no vinculante en Argentina)

Las reglas amendadas de COPPA (compliance obligatorio 22-abr-2026) separan el consentimiento primario (recolectar datos del menor) del consentimiento secundario (compartir con terceros para ads/entrenar IA) — ya no alcanza un solo checkbox bundleado. Los métodos aprobados van desde alta fricción (tarjeta de crédito, videollamada con personal entrenado, verificación de ID gubernamental) hasta el método "email plus": un email de confirmación con acción afirmativa del padre, aceptable cuando el dato se usa solo para operación interna del servicio (no para ads ni compartir con terceros) — que es exactamente el caso de Simón (alertas de crisis + resumen semanal, sin ads, sin third-party sharing per M-D1). Tarjeta de crédito/ID gubernamental son métodos de alta garantía usados en EE.UU. quiere decir cuando hay pago o alto riesgo de datos; no son el piso legal, son el techo.

Fuentes: [FTC — Verifiable Parental Consent](https://www.ftc.gov/business-guidance/privacy-security/verifiable-parental-consent-childrens-online-privacy-rule), [CGL LLP — VPC cliff notes](https://cgl-llp.com/insights/collecting-verifiable-parental-consent-coppa/)

### 1.2 Patrones reales de productos para menores

**Troomi/Troodi** (chatbot de salud mental IA para chicos, el caso más análogo a Simón): el tutor crea la cuenta primero, declara explícitamente ser padre/tutor legal autorizado, y luego vincula al menor vía Parent Portal — nunca al revés. Las conversaciones con Troodi son privadas por defecto salvo que el tutor elija visualizarlas, y el tutor recibe alertas en tiempo real ante disclosure de self-harm — el mismo patrón que M-P2 (resumen, no transcripción; alerta sí).

**ClassDojo y Khan Academy Kids** confirman el mismo patrón para menores sin cuenta propia previa: el tutor crea su cuenta con email, después agrega al menor (por código de invitación o directamente desde su dashboard); el menor **no necesita email propio** — Khan Academy explícitamente permite crear cuentas de menores sin email separado, y el tutor queda como "coach" permanente con permisos sobre qué puede hacer el menor.

Fuentes: [Troomi — Onboarding](https://troomi.com/onboarding-create-an-account/), [ClassDojo — Create a Parent Account](https://help.classdojo.com/hc/en-us/articles/205417305-Create-a-Parent-Account), [Khan Academy — Create accounts for you and your children](https://www.khanacademy.org/khan-for-educators/resources/parents-mentors-1/helping-your-child/a/create-accounts-for-you-and-your-children)

### 1.3 Ley 25.326 art. 5 + Res. AAIP — qué es razonable en Argentina

La Ley 25.326 exige consentimiento "libre, expreso e informado", documentado por escrito o medio equivalente; para datos sensibles (salud, categoría de las conversaciones de Simón per art. 2) el estándar es más estricto pero la ley no prescribe un método técnico específico de verificación de identidad del tutor — a diferencia de COPPA, no exige tarjeta de crédito ni ID. La AAIP no tiene hoy (2026-07-08) una resolución específica sobre "consentimiento verificable de menores" equivalente a COPPA; el proyecto de reforma de la ley (aún no sancionado) es el que empezaría a introducir "reglas de consentimiento verificable y perfiles de riesgo" para menores. Conclusión práctica: hoy en Argentina, un flujo de **email + confirmación con acción afirmativa documentada** (el tutor hace clic en un link único, ve un texto claro de qué implica, y esa aceptación queda timestamped en DB) cumple razonablemente el estándar de "consentimiento expreso e informado" sin necesidad de fricción tipo COPPA (tarjeta, ID, videollamada) — mientras se documente bien y no se dependa solo de un checkbox sin verificación de posesión del email.

Fuentes: [Ley 25.326 texto actualizado — Argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion), [La Defensa — leyes de datos personales AR](https://www.ladefensa.com.ar/la-defensa-de-datos-personales-en-argentina-que-leyes-te-protegen-y-como-ejercer-tus-derechos/)

### 1.4 Modelo de cuentas: ¿tutor crea cuenta y agrega al menor, o menor se registra y pide email del tutor?

| | Tutor crea cuenta → agrega menor (family account) | Menor se registra → pide email del tutor |
|---|---|---|
| **Pros** | Consentimiento existe *antes* de que el menor toque el chat (cumple M-P1 al pie de la letra: "antes de que el menor cree una cuenta"); tutor controla desde el día 1; menor no necesita email propio (relevante para 6-12 años, alineado con minimización de PII de ARCHITECTURE.md §3); patrón validado por Troomi/ClassDojo/Khan Academy | Menor puede empezar a explorar la app sin fricción de un adulto presente |
| **Contras** | Fricción de onboarding: requiere que el tutor esté presente/motivado en el primer contacto | Ventana de uso sin consentimiento entre el registro del menor y la confirmación del tutor (viola M-P1 si el chat queda accesible en ese lapso); requiere que el menor tenga o invente un email de tutor válido, sin garantía de que sea real; el chatbot de Simón toca temas de salud mental — dejar que un menor "pruebe" el chat sin consentimiento previo es exactamente el patrón de riesgo del caso Character.AI (research-safety.md §1.4) |

**Recomendación para Simón: tutor crea cuenta primero.** Encaja directo con el modelo `Guardian` ya bosquejado en ARCHITECTURE.md §3 (`consentAt`, `alertsEnabled`, email verificado) y con M-P1 ("verifiable... before any minor... creates an account"). El menor nunca ve el chat sin que exista ya un `Guardian.consentAt` no-nulo.

---

## 2. better-auth para el modelo guardian↔child

### 2.1 El plugin `organization` no encaja

Evaluado el plugin `organization` de better-auth (multi-tenancy con owner/admin/member, invitaciones por email, permisos custom) — está diseñado para equipos/empresas, no para relaciones tutor-menor: asume agencia igual entre miembros adultos, no hay age-gating ni lógica de consentimiento nativa, y las invitaciones son adulto-a-adulto. Es adaptable vía `additionalFields` y hooks (before/after) para meter ahí lógica de aprobación, pero eso es forzar una abstracción que no fue pensada para esto — más código y superficie de bugs para lo mismo que un modelo `Guardian` propio ya resuelve más simple (que es lo que ARCHITECTURE.md §3 ya planea).

Fuente: [better-auth — Organization plugin docs](https://better-auth.com/docs/plugins/organization)

### 2.2 Plugins de better-auth que sí sirven

**`magic-link`**: útil específicamente para el flujo de verificación de email del tutor — el tutor recibe un link, hace clic, y ese clic es el "acción afirmativa" que documenta el consentimiento (§1.3). Nota de seguridad relevante para datos de menores: al verificar por magic link una cuenta cuyo email nunca fue confirmado, better-auth revoca sesiones y contraseñas existentes de esa cuenta — email queda como fuente de verdad de identidad, que es justo el nivel de garantía que necesitamos para el tutor (no para el menor). El plugin nativo `emailVerification` (ya disponible en `betterAuth()` sin plugin extra, ver `lib/auth.ts` actual) cubre el caso más simple si no se quiere agregar magic-link todavía.

Fuentes: [better-auth — Magic Link docs](https://better-auth.com/docs/plugins/magic-link)

### 2.3 Roles en la misma tabla `User` vs tabla `Guardian` separada

No hay guía oficial de better-auth para "family accounts" — es un caso de uso fuera de su alcance central (auth genérico), así que la decisión es de diseño de schema, no de plugin. Dos opciones:

- **Campo `role` en `User`** (`child` | `guardian`), como ya anota ARCHITECTURE.md §3 Fase 1 — simple, pero un `User` de tipo `child` sigue siendo una fila de `better_auth.user` con email/password propio, lo cual empuja a que el menor tenga login propio (choca con la recomendación de §1.4 de que el menor no necesite email).
- **Tabla `Guardian` separada** vinculando `guardianUserId` (el `User` real, con email/password, que hace login) a uno o más menores — y el menor **no es un `User` de better-auth con credenciales propias**, sino un registro liviano (`ChildProfile` o extensión de `User` sin email/password real, autenticado vía sesión del padre o un PIN simple) que cuelga del `Guardian`.

**Recomendación:** usar el campo `role` en `User` (ya lo dice ARCHITECTURE.md) *solo* para el tutor que se loguea con better-auth normalmente, y la tabla `Guardian` como tabla de vínculo con `consentAt`/`alertsEnabled` apuntando a un `childUserId` que también vive en `User` pero sin email real verificado (o con un email interno tipo `child+<id>@simon.local` si better-auth exige `email unique @required` — ya es así en el schema actual, línea 15 de `prisma/schema.prisma`). Esto evita tocar el plugin `organization` y mantiene el modelo de datos que ARCHITECTURE.md ya decidió, solo agregando la tabla `Guardian` pendiente.

---

## 3. Email transaccional 2026: verificación de tutor + alerta de crisis + resumen semanal

| Proveedor | Free tier real | Límite duro | Deliverability | DX Next.js |
|---|---|---|---|---|
| **Resend** | 3.000 emails/mes | 100/día (fuerza upgrade antes del tope mensual si hay picos) | Buena con dominio propio + SPF/DKIM/DMARC; sin garantías, como todos | Nativo: SDK oficial + `react-email` para templates JSX, hecho para Next.js/Vercel |
| **Brevo** | ~300/día (~9.000/mes) | Volumen mensual más alto que Resend gratis | Test 2026 midió ~79,8% promedio, con caída a 72% en un round (posible issue Hotmail/Outlook) — inferior a Resend en pruebas independientes | API genérica, sin integración React nativa; agrega funciones de marketing que Simón no necesita |
| **Amazon SES** | 3.000 mensajes/mes gratis, pero solo los primeros 12 meses como cliente nuevo de AWS Free Tier | Después de eso, 100% pago (barato: ~$0.10/1000) | Buena a escala si se hace bien el warm-up de IP, pero consola básica y requiere salir del sandbox manualmente | Requiere más setup (IAM, dominio verificado, SDK AWS) — más fricción para un equipo de 1 persona |
| **Plunk** | 1.000/mes gratis (open source, AGPL-3.0, EU-hosted, self-hostable) | Pricing pay-per-email ($0.001/email) sin tiers arriba del free | No hay datos independientes de deliverability comparables a Resend/Brevo | SDK Node/Python, menos maduro/documentado que Resend para Next.js |

**Recomendación: Resend.** El volumen de Simón en el worst case de ARCHITECTURE.md (100 usuarios/día) genera muy pocos emails reales — verificación de tutor es un evento único por familia, alertas de crisis son (idealmente) raras, resumen semanal es 1 email/familia/semana. Con eso, el free tier de Resend (3.000/mes, 100/día) alcanza cómodo incluso en escala 10× antes de pagar los $20/mes de Pro. La razón decisiva no es el volumen sino la latencia y DX: para la alerta de crisis (M-P2, crítica por definición) importa más la integración simple y confiable con Next.js/Vercel que el volumen gratis de Brevo — y Brevo midió peor deliverability en pruebas 2026. SES es más barato a escala pero exige ops (IAM, warm-up) que no se justifican para 1 persona en esta fase; ya está presupuestado ~$3/mes en ARCHITECTURE.md §6 para "dominio + email transaccional", consistente con seguir en el free tier de Resend o el primer escalón pago.

Fuentes: [Resend — Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Resend — Pricing](https://resend.com/pricing), [Vibe Coder Blog — Resend vs SendGrid vs Postmark pricing](https://blog.vibecoder.me/email-service-pricing-resend-sendgrid-postmark), [Plunk — Pricing](https://www.useplunk.com/pricing)

---

## Recomendaciones para el orquestador

- **Modelo de cuentas:** el tutor crea la cuenta (better-auth normal, email/password o magic-link) y agrega al menor desde su panel — el menor nunca se registra solo ni necesita email propio. Bloquea acceso al chat hasta que exista `Guardian.consentAt`.
- **Flujo de consentimiento concreto:** (1) tutor se registra y verifica su email (magic-link o `emailVerification` nativo de better-auth) → (2) tutor completa un formulario de alta del menor (nombre, franja etaria, `birthYear`) → (3) pantalla de consentimiento explícita en lenguaje claro (qué es Simón, qué datos se guardan, que hay alertas de crisis) con checkbox + botón "Confirmo que soy el tutor legal" → (4) se persiste `consentAt` timestamped + IP/user-agent como evidencia → (5) recién ahí el menor puede loguearse (vía sesión delegada del tutor o PIN simple) y chatear.
- **Schema:** agregar tabla `Guardian` (ya bosquejada en ARCHITECTURE.md §3) vinculando `guardianUserId` ↔ `childUserId`, ambos filas de `User` de better-auth, sin usar el plugin `organization`.
- **better-auth:** usar `emailVerification` nativo (o plugin `magic-link` si se quiere passwordless) solo para el tutor; no meter al menor en el flujo de credenciales de better-auth con email real propio.
- **Proveedor de email:** Resend, para verificación de tutor + alerta de crisis + resumen semanal — free tier alcanza la fase actual, DX nativa con Next.js/react-email, upgrade a Pro ($20/mes) solo si el volumen lo justifica en escala 10×.
