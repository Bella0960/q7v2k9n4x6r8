// build-trigger: 2026-10-27 (v2)
import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Auto-detect all HTML entry points (root + feature subfolders) for multi-page setup
const htmlFiles = {};
(function collectHtml(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      collectHtml(abs, prefix + entry.name + '/');
    } else if (entry.name.endsWith('.html')) {
      htmlFiles[prefix + entry.name.replace(/\.html$/, '')] = abs;
    }
  }
})(__dirname, '');

export default defineConfig({
  base: './',
  plugins: [{
    name: 'copy-static-web-resources',
    apply: 'build',
    generateBundle() {
      // This project uses many classic script tags and relative static URLs.
      // Vite warns that classic scripts are not bundled; copy their referenced
      // files into dist at the same paths so they work after Worker deployment.
      const excludedDirs = new Set(['.git', '.github', 'node_modules', 'dist', '.wrangler']);
      const excludedFiles = new Set([
        '.gitignore', 'CLAUDE.md', 'README.md', 'package.json',
        'package-lock.json', 'bun.lock', 'vite.config.js',
        'wrangler.jsonc', 'wrangler.toml'
      ]);
      const allowedExtensions = new Set([
        '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp',
        '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf',
        '.mp3', '.m4a', '.wav', '.ogg', '.mp4', '.webm', '.pdf',
        '.xml', '.txt', '.wasm', '.avif', '.webmanifest', '.bin', '.glb'
      ]);

      const walk = (dir, relativeDir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || excludedDirs.has(entry.name)) continue;
          const absolutePath = resolve(dir, entry.name);
          const relativePath = relativeDir ? relativeDir + '/' + entry.name : entry.name;

          if (entry.isDirectory()) {
            walk(absolutePath, relativePath);
            continue;
          }

          if (excludedFiles.has(relativePath) || entry.name.endsWith('.html')) continue;
          const dot = entry.name.lastIndexOf('.');
          const extension = dot >= 0 ? entry.name.slice(dot).toLowerCase() : '';
          if (!allowedExtensions.has(extension)) continue;

          this.emitFile({
            type: 'asset',
            fileName: relativePath,
            source: fs.readFileSync(absolutePath)
          });
        }
      };

      walk(__dirname, '');
    }
  }],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true
  },
  preview: {
    host: '0.0.0.0',
    port: 3000
  },
  build: {
    rollupOptions: {
      input: htmlFiles
    }
  }
});
