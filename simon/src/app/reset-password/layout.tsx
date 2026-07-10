import type { Metadata } from "next";

// La page es client component ("use client") y no puede exportar metadata, así
// que el título vive en el layout del segmento. Copy alineado con el flujo de
// "Elegí una contraseña nueva".
export const metadata: Metadata = {
  title: "Nueva contraseña — Simón",
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
