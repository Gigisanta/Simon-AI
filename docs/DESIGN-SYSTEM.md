# Design System — Simón

Fuente de verdad visual. Referencia: `simon-mocha.vercel.app` (tokens extraídos del sitio real).
Regla: patrones, no píxeles clonados; el contenido y las features son SIEMPRE reales (nada mock).

## 1. Fundamentos

### Tipografía
- **Nunito** (next/font/google, variable) — única familia.
- H1 hero: `text-[40px] font-extrabold leading-[1.25] tracking-[-1px]` (mobile: 32px).
- H1 páginas internas: `text-4xl font-extrabold tracking-tight`.
- Body 16px; secundario 14px `text-ink-soft`; kickers 12–13px `font-extrabold uppercase tracking-wide`.

### Color (tokens Tailwind v4 `@theme`)
| Token | Hex | Uso |
|---|---|---|
| `cream` | `#f8f3e8` | fondo base |
| `card` | `#fefcf5` | superficies |
| `ink` | `#393529` | texto |
| `ink-soft` | `#6d6958` | texto secundario |
| `line` | `#e3decf` | bordes |
| `sand` | `#f1ebdb` | fondos suaves |
| `brand` | `#5a7f61` | primario |
| `brand-strong` | `#4a6a50` | hover |
| `brand-soft` | `#d9eede` | burbuja Simón, fondos |
| `brand-ill` | `#7fa184` | verde ilustración |
| `brand-fg` | `#fdfcf8` | texto sobre brand |
| `accent` | `#e2a983` | terracota |
| `accent-deep` | `#503223` | texto sobre peach |
| `peach` | `#fbe7d8` | burbuja usuario |
| `blush` | `#f2c4a7` | mejillas / sol |
| `sky` | `#c2e0f2` | pastel frío |
| `sky-strong` | `#5b8caf` | énfasis frío |
| `danger` | `#d9544b` | errores / destructivo |
| Tints (cards 36px sin borde) | `peach-tint #fbe9dc` · `green-tint #e4f1e6` · `sky-tint #e3eff8` | feature cards |

Colores por categoría de ficha (kicker + arco izquierdo; AA sobre blanco):
`neuro #6d5bd0` · `intel #3a7d54` · `motora #c14b43` · `sensorial #b8447a` · `pocofrec #a06b14` · `tramites #46708c`.

### Fondo de página
Wash vertical (extraído del sitio):
`body { background: linear-gradient(180deg, #f7f2e5 0%, #eef0dd 45%, #f6efe2 100%) fixed; }`
(las páginas largas mantienen `bg-cream` de fallback).

### Radios y sombras
- Cards: `rounded-card` (1.25rem). Tint cards: `rounded-[36px]`.
- Pills/botones/inputs: `rounded-full`.
- Header: `shadow-[0_1px_3px_rgb(0_0_0/0.1),0_1px_2px_-1px_rgb(0_0_0/0.1)]`, `bg-card/80 backdrop-blur`.
- Cards interactivas: `shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)]`, hover `-translate-y-0.5` + sombra más honda (`motion-safe:` + respetar modo calma).

### Motion
150–200 ms, `motion-safe:` siempre; modo calma y `prefers-reduced-motion` matan todo (ya en globals). Typing indicator: 3 puntos con `animate-bounce` escalonado dentro de burbuja `brand-soft`.

## 2. Identidad

### Logo/avatar (SVG exacto de la referencia — usar tal cual)
Squircle `rx=22` `#7fa184`, ojos/sonrisa blancos, mejillas `#f2c4a7` opacity .75, brote `#5d7f63`:
```svg
<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <path d="M32 10 C30 4 24 2 20 3 C22 7 26 10 30 10.5 Z" fill="#5d7f63"/>
  <line x1="32" y1="10" x2="32" y2="14" stroke="#5d7f63" stroke-width="2.5" stroke-linecap="round"/>
  <rect x="8" y="13" width="48" height="46" rx="22" fill="#7fa184"/>
  <circle cx="24" cy="34" r="3.2" fill="#ffffff"/>
  <circle cx="40" cy="34" r="3.2" fill="#ffffff"/>
  <path d="M25 44 Q32 50 39 44" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none"/>
  <circle cx="17.5" cy="41" r="3" fill="#f2c4a7" opacity="0.75"/>
  <circle cx="46.5" cy="41" r="3" fill="#f2c4a7" opacity="0.75"/>
</svg>
```

### Ilustración hero (SVG exacto — adulto + niño, corazón, hojas, sol)
```svg
<svg viewBox="0 0 220 150" fill="none" class="h-auto w-full" aria-hidden="true">
  <circle cx="185" cy="32" r="16" fill="#f2c4a7" opacity="0.85"/>
  <ellipse cx="110" cy="136" rx="88" ry="9" fill="#ede3ce"/>
  <circle cx="82" cy="52" r="15" fill="#7fa184"/>
  <path d="M82 67 C64 67 58 84 60 104 Q61 118 66 128 L98 128 Q103 118 104 104 C106 84 100 67 82 67 Z" fill="#7fa184"/>
  <circle cx="132" cy="82" r="11" fill="#e09a72"/>
  <path d="M132 93 C120 93 116 104 117 116 Q118 124 121 128 L143 128 Q146 124 147 116 C148 104 144 93 132 93 Z" fill="#e09a72"/>
  <path d="M100 88 Q110 96 119 100" stroke="#3f4a41" stroke-width="4" stroke-linecap="round" opacity="0.5"/>
  <path d="M110 68 c2.6 -4.6 9 -2.2 8 2.4 c-0.8 3.4 -5.4 6 -8 7.6 c-2.6 -1.6 -7.2 -4.2 -8 -7.6 c-1 -4.6 5.4 -7 8 -2.4 Z" fill="#e09a72" opacity="0.9"/>
  <path d="M22 128 Q18 112 32 104 Q34 120 22 128 Z" fill="#5d7f63" opacity="0.7"/>
  <path d="M198 126 Q206 112 194 102 Q188 116 198 126 Z" fill="#7fa184" opacity="0.7"/>
</svg>
```
Hojas decorativas sueltas (mismo estilo `#5d7f63`/`#7fa184` opacity .5–.7) flotando en el hero, `aria-hidden`.

## 3. Componentes

- **Header** (todas las páginas, sticky): logo 40px + "Simón" extrabold + tagline "Acompañamos cada paso" 12px. Derecha (desktop): contenedor pill `bg-card/80 border border-line/70 rounded-full p-1 gap-1 shadow-sm` con tabs: Chat, Aprender (solo guardian), Tutor (solo guardian); tab activa = `bg-brand text-brand-fg rounded-full` con icono. Fuera del pill: ayuda urgente, modo calma, salir.
- **Bottom nav mobile** (`md:hidden`, fixed bottom, pill flotante con blur y sombra): mismos ítems con icono + label 11px; activo = círculo brand con icono blanco. El contenido de página lleva `pb-24 md:pb-0` para no quedar tapado.
- **Quick-start cards** (empty state del chat, arriba de los mood chips): 2–3 cards `bg-card rounded-card shadow` con icono en círculo pastel + kicker de color + pregunta bold; click = envía mensaje REAL al chat. Título "¿Por dónde querés empezar?".
- **Burbujas**: Simón `bg-brand-soft` / usuario `bg-peach`, `rounded-2xl` con esquina pegada `rounded-bl-sm`/`rounded-br-sm`, etiqueta de rol visible (SH-U5).
- **Ficha card** (/aprender): `bg-card rounded-card` con arco izquierdo de color (`border-left` 6px curvo — usar `border-l-[6px]` + `rounded-l-[26px]` o pseudo-elemento) + kicker por categoría + título bold. Grid responsive 1/2/3 col. Filtros: chips pill (activa = brand). Búsqueda: input pill con icono lupa. Detalle: `<dialog>` nativo con body, fuente legal y badge "Contenido en revisión profesional" (reviewed=false).
- **Footer** de páginas: "Simón acompaña, no reemplaza la ayuda de una persona 🌱" centrado, 13px ink-soft.

## 4. Accesibilidad (no negociable)
Touch ≥44px · foco visible brand · contraste AA (kickers con los hex de categoría de arriba, no los pasteles) · `role="log"` + `aria-live` en chat · `<dialog>` nativo para modales · modo calma y reduced-motion respetados · banner de divulgación IA siempre visible en el chat.
