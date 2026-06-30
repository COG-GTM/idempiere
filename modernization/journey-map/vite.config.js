import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from GitHub Pages at https://cog-gtm.github.io/idempiere/
export default defineConfig({
  plugins: [react()],
  base: process.env.PAGES_BASE || "/idempiere/",
});
