import fs from "fs"
import path from "path"
import { createHash } from "crypto"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// Writes dist/sw.js: the service worker that stores the app shell so VitaLink
// opens offline. Its file list (and so its version) changes with every build.
function offlineShell(): Plugin {
  return {
    name: 'vitalink-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      const publicDir = path.resolve(__dirname, 'public');
      const statics = fs.readdirSync(publicDir).filter((file) => {
        const stat = fs.statSync(path.join(publicDir, file));
        return stat.isFile() && stat.size < 2_000_000 && !/\.(mp4|webm|mov)$/i.test(file);
      });
      // index.html is emitted after this hook runs, so it's added by name.
      const files = [...new Set(['index.html', ...built, ...statics])].sort();
      const template = fs.readFileSync(path.resolve(__dirname, 'sw/service-worker.js'), 'utf8');
      const version = createHash('sha256').update(files.join(',')).update(template).digest('hex').slice(0, 12);
      const source = template
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Absolute asset paths: deep links such as /emr/VL-2026-000002 must still load /assets/...
  base: '/',
  plugins: [inspectAttr(), react(), offlineShell()],
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

