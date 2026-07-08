---
name: simon-review-context
description: Cómo revisar Simon AI - gitlink sin repo git interno (no usar git diff), suites tsx importan código real, invariantes de seguridad del chat
metadata:
  type: project
---

Simon AI (`/Users/prueba/HerMaatOS/repos/Simon-AI/simon`): app Next.js 16 de acompañamiento emocional para menores (Argentina, Ley 25.326).

**Why:** el directorio es un gitlink sin `.git` interno — `git diff` no funciona; las reviews se hacen leyendo archivos directo. Construida en slices en una sesión (2026-07-08).

**How to apply:**
- Revisar archivos directamente, nunca `git diff`.
- Las suites de `scripts/*.ts` (tsx, sin framework) importan el código real de `src/lib` — no hay copias desincronizadas de lógica; verificar que siga así.
- Invariantes de seguridad del chat (`app/api/chat/route.ts`): crisis SIEMPRE gana sobre sesión/errores; generación paralela con moderación de entrada, la generación descartada nunca se persiste; salida fail-closed vía `resolveUnmoderatedOutput`; alertas solo crisis/abuso con dedupe 1h.
- Puntos débiles conocidos (hallazgos 2026-07-08): rate-limit in-memory `sweep()` cross-window; historial de mensajes del cliente sin filtrar por rol; `saveAssistant` sin try/catch en paths de crisis; alta de menor no transaccional.
