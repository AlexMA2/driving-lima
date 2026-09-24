import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import * as sass from 'sass';

const CRITICAL_ENTRY = fileURLToPath(new URL('./src/styles/critical.scss', import.meta.url));

// Critical CSS. The stylesheet the first screen needs (src/styles/critical.scss) is compiled here and inlined in a
// <style> tag of index.html, so the home screen paints without waiting for a CSS request. It is not imported by
// any script; every other stylesheet is imported by the module that needs it and travels with that module's
// lazily loaded chunk.
function criticalCss(): Plugin {
  let minify = false;
  const sources = new Set<string>(); // the entry and every partial it pulls in

  return {
    name: 'critical-css',

    configResolved(config) {
      minify = config.command === 'build' && config.build.minify !== false;
    },

    async transformIndexHtml() {
      const { css, loadedUrls } = sass.compile(CRITICAL_ENTRY, { style: 'expanded', charset: false });
      sources.clear();
      loadedUrls.forEach(url => sources.add(fileURLToPath(url)));
      sources.add(CRITICAL_ENTRY);

      const out = minify ? (await transformWithEsbuild(css, 'critical.css', { loader: 'css', minify: true })).code : css;
      return [{ tag: 'style', attrs: { id: 'critical-css' }, children: out.trim(), injectTo: 'head' }];
    },

    // The inlined stylesheet is not part of the module graph, so editing it needs a page reload.
    handleHotUpdate({ file, server }) {
      if (!sources.has(file)) return;
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

export default defineConfig({
  plugins: [criticalCss()],
  server: {
    port: 5173,
    open: true,
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern' },
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // The two engines are big and change rarely: their own long-lived chunks, fetched only with the game.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/cannon-es')) return 'cannon';
        },
      },
    },
  },
});
