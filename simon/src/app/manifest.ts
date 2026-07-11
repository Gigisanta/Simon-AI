import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Simón — Acompañamos cada paso",
    short_name: "Simón",
    description: "Un espacio seguro para hablar, entender lo que te pasa y aprender paso a paso.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f3e8",
    theme_color: "#5a7f61",
    lang: "es-AR",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
