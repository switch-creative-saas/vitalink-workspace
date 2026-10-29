import fs from "fs"
import path from "path"
import { createHash } from "crypto"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// Writes dist/sw.js: the service worker that stores the app so VitaLink opens offline. It installs
// with only the core (entry script, its imports, styles, icons) so a slow connection isn't swamped;
// the rest (other pages, charts, maps) is cached as it's used, and in the background on good
// connections. Its file lists (and so its version) change with every build.
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
      // Core: every entry chunk plus what it imports statically, and their styles.
      const core = new Set<string>(['index.html', ...statics.filter((file) => /icon|logo/.test(file))]);
      const visit = (file: string) => {
        const chunk = bundle[file];
        if (!chunk || core.has(file)) return;
        core.add(file);
        if (chunk.type !== 'chunk') return;
        chunk.viteMetadata?.importedCss.forEach((css) => core.add(css));
        chunk.imports.forEach(visit);
      };
      Object.entries(bundle).forEach(([file, chunk]) => { if (chunk.type === 'chunk' && chunk.isEntry) visit(file); });
      // index.html is emitted after this hook runs, so it's added by name.
      const files = [...new Set(['index.html', ...built, ...statics])].sort();
      const precache = files.filter((file) => core.has(file));
      const warm = files.filter((file) => !core.has(file));
      const template = fs.readFileSync(path.resolve(__dirname, 'sw/service-worker.js'), 'utf8');
      const version = createHash('sha256').update(files.join(',')).update(template).digest('hex').slice(0, 12);
      const source = template
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__WARM__', JSON.stringify(warm));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Absolute asset paths: deep links such as /emr/VL-2026-000002 must still load /assets/...
  base: '/',
  plugins: [inspectAttr(), react(), offlineShell()],
  build: {
    rollupOptions: {
      output: {
        // Core libraries in their own files: they change rarely, so browsers keep them cached across
        // releases. Libraries only one page uses (charts) split off with that page by themselves.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('@radix-ui')) return 'ui';
          return undefined;
        },
      },
    },
  },
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

