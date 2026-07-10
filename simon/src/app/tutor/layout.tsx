import type { Metadata } from "next";

// El título vive en el layout del segmento (no en la page) para no tocar
// src/app/tutor/page.tsx. Copy alineado con el encabezado del panel ("Panel
// del tutor/a").
export const metadata: Metadata = {
  title: "Panel del tutor/a — Simón",
};

export default function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
