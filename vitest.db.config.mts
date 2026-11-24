import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de base de datos (npm run test:pglite): migraciones y seed en PGlite, sin Supabase ni contraseñas.
// Separados de `npm test` (dominio) porque cada fichero arranca su propia base de datos (unos segundos).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Cada fichero tiene su base en memoria (~150 MB); con 4 a la vez basta y no se dispara la memoria en CI.
    maxWorkers: 4,
  },
});
