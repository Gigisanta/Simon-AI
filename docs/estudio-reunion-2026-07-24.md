# Simón — Estudio para la reunión (versión simple)
## Leé esto como si fuera una charla. Sin jerga. Sin tecnicismos.

---

## Primero: qué es Simón (explicalo como si le hablaras a tu mamá)

Simón es una **app para chicos y adolescentes** donde pueden hablar de cómo se sienten. Como un amigo que siempre está disponible, pero que **no es una persona** — es una inteligencia artificial.

**La diferencia con cualquier otra app:** la seguridad no depende de que la IA "sea buena". Hay reglas fijas, escritas por humanos, que la IA no puede saltear.

**Ejemplo:** si un chico escribe "me quiero morir", la app no le pregunta a la IA qué responder. Le muestra directamente una respuesta escrita por profesionales, con teléfonos de ayuda reales. Como un extintor: no le pedís al extintor que "decida" si hay fuego. Lo usás cuando hay fuego.

---

## La frase que tenés que repetir todo el rato

**"La IA propone, el código decide."**

¿Qué significa? Que la inteligencia artificial genera texto, pero el sistema de reglas (el código) decide qué texto llega al chico. Si la IA genera algo riesgoso, el código lo reemplaza antes de que el chico lo vea.

---

## Por qué existe (el problema)

- En Neuquén hubo **86 suicidios en 2023**.
- Hay **menos de 2 psiquiatras cada 100.000 personas** en la región.
- **1 de cada 8 jóvenes** ya habla de salud mental con chatbots que no tienen ninguna protección para menores (como Character.AI).
- La alternativa a Simón **no es "nada"**: es un chatbot sin filtros donde un chico puede hablar de crisis y nadie se entera.

---

## Cómo funciona (la analogía del edificio)

Imaginate un edificio de 3 pisos:

- **Piso 3 (abajo):** El chico escribe. Una inteligencia artificial genera una respuesta.
- **Piso 2 (medio):** Un sistema de reglas revisa esa respuesta. Si detecta algo riesgoso, la reemplaza por una respuesta segura escrita por humanos.
- **Piso 1 (arriba):** Todo se guarda en una base de datos con reglas de cuánto tiempo se guarda y qué se guarda.
- **Planta baja:** El tutor (padre/madre) tiene que dar permiso antes de que el chico pueda usar la app.

**Lo clave:** si el Piso 3 (la IA) falla o se equivoca, el Piso 2 (las reglas) sigue funcionando. La seguridad no depende de la IA.

---

## Qué es "determinístico" (explicado fácil)

**Determinístico = siempre hace lo mismo.**

Como una receta de cocina: si seguís los mismos pasos con los mismos ingredientes, siempre sale lo mismo. No hay sorpresas.

En Simón: si un chico escribe algo sobre crisis, la app siempre muestra la misma respuesta segura. No improvisa. No "decide". Siempre lo mismo.

---

## Qué es "fail-closed" (explicado fácil)

**Fail-closed = si algo falla, se cierra.**

Como una puerta con cerradura eléctrica: si se corta la luz, la puerta se queda cerrada. No se abre sola.

En Simón: si el sistema no puede verificar si un mensaje es seguro, **no lo muestra**. Es mejor no mostrar nada que mostrar algo riesgoso.

---

## Qué datos guardan (y qué NO)

**SÍ guardan:**
- Email del padre/madre/tutor
- Año de nacimiento del chico (no la fecha completa)
- La conversación (por un tiempo limitado: 365 días)
- Datos de seguridad (qué pasó, cuándo, qué decidió el sistema — nunca el texto de la conversación)

**NO guardan:**
- Dirección
- Escuela
- Fotos
- Ubicación
- Datos biométricos

**Todo se borra según un calendario.** Nada se guarda "por las dudas".

---

## El laboratorio (por qué construyen su propio modelo)

Esto es lo más importante de la reunión. No es un detalle técnico — es la propuesta central.

**¿Qué están haciendo?** Construyendo su propio modelo de inteligencia artificial, especializado en español rioplatense y en seguridad para menores.

**¿Por qué?** 4 razones:

1. **Soberanía:** Los datos de menores argentinos los procesa un modelo propio, no uno extranjero.
2. **Offline:** En escuelas rurales de Neuquén puede no haber internet. Un modelo propio puede funcionar en el dispositivo del chico sin conexión.
3. **Innovación:** No existe en el mundo ningún modelo de inteligencia artificial en español que sea chico (para que ande en cualquier celular), ni un eval de seguridad infantil en español, ni un laboratorio argentino de esto. Serían los primeros.
4. **Control:** Hoy dependen de un proveedor que no tiene contrato ni garantías. Con modelo propio, control total.

**¿No es caro?** No. El proveedor actual (DeepSeek) cuesta USD 7 por mes. La razón NO es plata — es soberanía y control.

**La familia de modelos:**
- **maat-nano** (150 millones de parámetros): anda en cualquier celular y en el navegador.
- **maat-micro** (250 millones): el candidato principal para celulares.
- **maat-mini** (400 millones): mejor calidad, también para celulares.
- **maat-1B** (mil millones): solo si los chicos no alcanzan.

**Lo más importante:** cada modelo entrega valor por sí solo. Si el más chico no funciona, no se pierde nada — se usa el siguiente. Y mientras tanto, el proveedor comercial queda como respaldo automático.

---

## Los "gates" (puertas que hay que abrir antes de usar datos reales)

Hay 7 cosas que deben cerrarse antes de que la app pueda usarse con menores reales. Si una sola queda abierta, no hay piloto. Esto no es un bug — es un requisito de seguridad.

1. **Consentimiento separado:** El padre tiene que aprobar por separado "usar la app" y "usar los datos para entrenar la IA". No es lo mismo.
2. **Rate limit:** Que no se puedan crear 1000 cuentas falsas desde la misma computadora.
3. **Alertas no perdidas:** Si el email al tutor falla, el sistema reintenta y avisa que falló.
4. **TTL del mood:** Definir cuánto tiempo se guarda cómo se siente el chico.
5. **Proveedor de IA aprobado:** El actual es para pruebas. Para producción se necesita contrato con garantías.
6. **Prueba de restauración:** Demostrar que si se borra todo, se puede recuperar.
7. **Email del tutor verificado:** Que las alertas lleguen a un email real, no uno de prueba.

**Si uno queda abierto → NO hay piloto con datos reales.**

---

## Qué pasa cuando algo falla (resiliencia)

| Si falla... | Qué pasa | Qué sigue funcionando |
|---|---|---|
| El proveedor de IA | Cambia automáticamente a otro proveedor | Las crisis (porque no dependen de la IA) |
| La base de datos | La app muestra error | Los datos están seguros, se pueden restaurar |
| El hosting (Vercel) | La app no anda | Los datos están seguros en otro lado |
| El email al tutor | El sistema reintenta automáticamente | La alerta no se pierde |

**Regla:** si algo falla, se pierde funcionalidad (el chat se pausa), pero **nunca seguridad** (las crisis siempre funcionan).

---

## Las preguntas que pueden hacerte (y qué responder)

**"¿La IA puede decir algo dañino a un chico?"**
→ Nunca llega al menor sin pasar por un filtro. Si hay riesgo, se reemplaza con una respuesta fija escrita por profesionales.

**"¿Por qué no usan ChatGPT directamente?"**
→ ChatGPT no fue diseñado para menores. No tiene permiso de los padres, no tiene filtros de crisis, y guarda datos para entrenar su IA.

**"¿La IA 'aprende' de los chicos?"**
→ No. Los datos de menores no se usan para entrenar. La IA procesa y olvida.

**"¿Qué datos guardan?"**
→ Lo mínimo: email del tutor, año de nacimiento, consentimiento. No dirección, no escuela, no fotos.

**"¿El padre puede leer las conversaciones?"**
→ No. Recibe alertas si hay riesgo y un resumen semanal de temas. No las conversaciones completas.

**"¿USD 3.000 por mes es caro?"**
→ Es USD 0,05 por neuquino por año. El piso del rango internacional.

**"¿Esto reemplaza psicólogos?"**
→ No. Es acompañamiento y derivación. La provincia tiene menos de 2 psiquiatras cada 100.000 personas. Llega donde no hay.

**"¿Por qué no microservicios?"**
→ Más simple de auditar y asegurar. Para un piloto con una jurisdicción, no necesitamos complejidad.

**"¿Por qué construir su propio modelo?"**
→ Soberanía de datos de menores, funcionamiento sin internet en escuelas rurales, y un nicho vacío: no existe nada igual en el mundo.

**"¿Qué pasa si se cae el proveedor de IA?"**
→ Cambia a otro automáticamente. Las crisis no dependen del proveedor.

**"¿Dónde están los datos?"**
→ En servidores de EEUU. Cumplen la ley argentina. Si piden que estén en Argentina, es decisión de costo.

**"¿Qué pasa si la empresa desaparece?"**
→ El código es estándar, no propietario. La provincia puede migrar o hospedarlo internamente.

---

## Los números para tirar

- **37 suites, 1198 tests, 72/72 baseline crítico**
- ~60% tests unitarios, ~30% integración, ~10% E2E
- **72 crisis fixtures** (suicidio, autolesión, abuso, alimentario, bullying, sustancias, grooming)
- **7 gates P0** antes de datos reales
- **≥99,5% disponibilidad** durante el piloto
- **365 días** de conversación, **90 días** de memoria, **730 días** de safety
- **USD 3.000/mes** plataforma, **USD 11.000** lab (única vez)
- **86 suicidios** Neuquén 2023, **<2 psiquiatras** cada 100k
- **Familia Maat:** 150M → 250M → 400M → 1B

---

## Lo que NO tenés que decir

- ❌ "Previene suicidios" → No hay evidencia.
- ❌ "Es como un psicólogo" → No lo es.
- ❌ "La IA aprende de los chicos" → No se usa para entrenar.
- ❌ "Es 100% seguro" → Nada lo es.
- ❌ "Listo en 2 semanas" → Los 7 gates toman tiempo.
- ❌ "DeepSeek es nuestro proveedor" → Es el de desarrollo, no el institucional.

---

## Las 3 decisiones que necesitamos de ellos

1. **Datos:** ¿Quién se hace cargo de los datos? ¿Cuánto tiempo se guardan? ¿Dónde están?
2. **Cohorte:** ¿Cuántos chicos? ¿Qué edades? ¿Dónde?
3. **Operación:** ¿Quién es el responsable técnico? ¿Cuándo hacemos la reunión técnica de 90 minutos?

---

## El cierre (leelo en voz alta)

"Si acordamos quién se hace cargo de los datos, qué proveedores aprobamos, y cuándo hacemos la reunión técnica, convertimos los siete requisitos en una lista de tareas con responsable y fecha. Sin ese acuerdo, no proponemos usar datos reales. La seguridad no se negocia."

---

## Para salir con

- ☐ Nombre del responsable técnico
- ☐ Nombre del responsable de datos
- ☐ Nombre del responsable de seguridad
- ☐ Fecha de la reunión técnica de 90 minutos

---

## Resumen en una oración

**Simón es una app para chicos donde la IA nunca tiene la última palabra — las reglas de seguridad son fijas, escritas por humanos, y no dependen de que la IA funcione bien. Además, están construyendo su propio modelo de IA en español, algo que no existe en el mundo.**

---

Listo. Leelo una vez hoy, practicá las preguntas en voz alta, y mañana estás.
