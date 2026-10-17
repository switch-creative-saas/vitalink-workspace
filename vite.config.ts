import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Allow Cloudflare quick tunnels (https://*.trycloudflare.com) so phones can open the dev app,
    // e.g. to test telemedicine visit links (cameras need HTTPS off localhost).
    allowedHosts: ['.trycloudflare.com'],
    watch: {
      // Prevent Vite from watching large media files in public/ — avoids EBUSY crash
      ignored: ['**/public/**/*.mp4', '**/public/**/*.webm', '**/public/**/*.mov'],
    },
  },
});

