import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { hmr: { clientPort: Number(process.env.PORT ?? 5178) } },
  build: { outDir: "dist" },
});
