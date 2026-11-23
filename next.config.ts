import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hay otro package-lock.json fuera del proyecto: se fija aquí la raíz para el tracing.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
