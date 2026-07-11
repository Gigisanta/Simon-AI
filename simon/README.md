# Simón AI

Acompañante emocional con IA para niños y adolescentes (6–18), en español rioplatense.
**No es un terapeuta ni lo simula.** El alta de un menor la hace un tutor/a desde su
propia cuenta (verificada por email), y toda respuesta pasa por una capa de moderación
y un protocolo de crisis. Cada decisión de diseño está subordinada al protocolo de
seguridad de [`docs/research-safety.md`](../docs/research-safety.md).

## Stack

- **Next.js 16 + React 19 + Tailwind v4** — UI + API en un solo deploy.
- **Prisma 7** con driver adapter de Neon (`@prisma/adapter-neon`) sobre **Postgres (Neon)**.
- **better-auth** — sesiones y credenciales en nuestra propia DB (datos de menores = datos sensibles, Ley 25.326).
- **AI SDK v7** (`@ai-sdk/openai-compatible`) — proveedor de LLM intercambiable por env var (default `deepseek-v4-flash` vía gateway OpenCode Go).
- **Resend** — email transaccional (verificación del tutor/a, alertas de crisis).
- **zod** — validación de entrada.

Arquitectura completa en [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Docs de
research: [`research-safety.md`](../docs/research-safety.md) (crisis, regulación, UX
para menores — lectura obligatoria antes de tocar el chat),
[`research-architecture.md`](../docs/research-architecture.md) (LLM/RAG/moderación),
[`research-guardian.md`](../docs/research-guardian.md) (flujo del tutor/a),
[`DESIGN-SYSTEM.md`](../docs/DESIGN-SYSTEM.md).

## Setup

1. Copiá el ejemplo de entorno y completá los valores:
   ```bash
   cp .env.example .env.local
   ```
   Cada variable está documentada en [`.env.example`](.env.example). En Vercel, la DB
   la provee la integración Neon del Marketplace; en local, `vercel env pull` deja las
   URLs en `.env.local`.
2. Instalá dependencias:
   ```bash
   pnpm install
   ```
3. Generá el cliente Prisma y aplicá las migraciones (usa `DATABASE_URL_UNPOOLED`):
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```
4. Sembrá la base de conocimiento (RAG liviano):
   ```bash
   pnpm db:seed
   ```
5. Levantá el server de desarrollo:
   ```bash
   pnpm dev
   ```

## Build

`pnpm build` corre tres pasos: `prisma generate && tsx scripts/migrate-if-production.ts && next build`.

El guard [`scripts/migrate-if-production.ts`](scripts/migrate-if-production.ts) aplica
`prisma migrate deploy` **solo** cuando `VERCEL_ENV=production` (o cuando se fuerza con
`ALLOW_MIGRATE=1`). En cualquier otro entorno no migra. Para un build puro que no toque
la DB, corré directamente:

```bash
npx next build
```

## Tests

El gate determinístico corre 24 suites en procesos aislados y agrega el resultado:

```bash
pnpm test            # todas
pnpm test crisis     # subconjunto por nombre
```

El listado completo y siempre actualizado de suites es el array `SUITES` en
[`scripts/run-suites.ts`](scripts/run-suites.ts) (fuente única). Cubren, entre otras,
safety/crisis (`crisis`, `moderation`), guardián y menores (`guardian*`), memoria y
retención (`memory`, `retention`, `purge`), retrieval/knowledge y auth/seguridad
(`rate-limit`, `csp`, `env-check`).

Type-check y lint:

```bash
npx tsc --noEmit
pnpm lint
```

`scripts/conversation-eval.ts` es un harness exploratorio que llama al LLM real (no
determinístico) — queda **fuera** del gate.

## Cron de purga / retención

Vercel Cron dispara `/api/cron/purge` a diario (04:00, ver
[`vercel.json`](vercel.json)) para borrar datos vencidos por retención (TTL). La ruta
exige `Authorization: Bearer $CRON_SECRET` con comparación timing-safe: **sin
`CRON_SECRET` en runtime responde 503 y no corre** (fail-closed, nunca abierta). Seteá
`CRON_SECRET` en el proyecto de Vercel para que el cron funcione.

## Nota sobre Next.js 16

Ver [`AGENTS.md`](AGENTS.md): este proyecto usa Next.js 16, con convenciones y APIs que
difieren de versiones previas. Consultá la guía en `node_modules/next/dist/docs/` antes
de escribir código.
