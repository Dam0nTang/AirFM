import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/stream": { target: "ws://127.0.0.1:3000", ws: true },
      "/.cache": "http://127.0.0.1:3000"
    }
  }
});
