import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Simón — Acompañamos cada paso",
  description:
    "Simón — asistente de IA para acompañar y orientar. No reemplaza a un profesional de la salud.",
  // App privada de familias con datos de menores: no indexar ni seguir enlaces
  // (refuerza el disallow total de src/app/robots.ts).
  robots: { index: false, follow: false },
};

// Fix 2025 para el teclado virtual en chats mobile: `interactiveWidget:
// "resizes-content"` hace que el viewport se achique al abrir el teclado (junto
// con el h-dvh que ya usamos). themeColor = fondo cream de la app.
export const viewport: Viewport = {
  themeColor: "#f8f3e8",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce por request que inyecta el Proxy (src/proxy.ts) vía header x-nonce.
  // Leer headers() vuelve el render dinámico — condición necesaria del enfoque
  // de nonce (las páginas estáticas no tienen request donde inyectarlo).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="es-AR"
      suppressHydrationWarning
      className={`${nunito.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Aplica modo calma antes del primer paint (evita flash de animaciones) */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("simon-calm")==="1")document.documentElement.setAttribute("data-calm","")}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
