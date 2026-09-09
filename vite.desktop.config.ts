import { defineConfig } from "vite";
export default defineConfig({
  root: "desktop",
  publicDir: false,
  server: { host: "127.0.0.1", port: 5190, strictPort: true, fs: { allow: ["."] } },
  build: { outDir: "../dist-desktop", emptyOutDir: true, target: "es2022" },
});
