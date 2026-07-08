import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Simón",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
