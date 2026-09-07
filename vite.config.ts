import { defineConfig } from "vite";
export default defineConfig({
  publicDir: "examples",
  server: {
    port: 5188,
    strictPort: true,
    proxy: { "/bridge": "http://127.0.0.1:5189" },
  },
  build: { target: "es2022" },
});
