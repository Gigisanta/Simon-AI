import type { MetadataRoute } from "next";

// App privada de familias con datos de menores: no debe indexarse nada.
// Disallow total para todos los crawlers (complementa metadata.robots noindex
// en el layout raíz).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
