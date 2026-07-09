import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Simón — Acompañamos cada paso",
  description:
    "Simón — asistente de IA para acompañar y orientar. No reemplaza a un profesional de la salud.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      suppressHydrationWarning
      className={`${nunito.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Aplica modo calma antes del primer paint (evita flash de animaciones) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("simon-calm")==="1")document.documentElement.setAttribute("data-calm","")}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
