import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Relative URLs keep the client working over file:// in Electron.
const brandAssets = [
  { source: here('../../branding/icon.png'), target: 'favicon.png' },
  { source: here('../../branding/logo.png'), target: 'branding/logo.png' },
  { source: here('../../branding/emblem.png'), target: 'branding/emblem.png' },
  { source: here('../../branding/icon.svg'), target: 'branding/icon.svg' },
];
function brandingImages(): Plugin {
  return {
    name: 'branding-images',
    generateBundle() {
      for (const asset of brandAssets) {
        this.emitFile({ type: 'asset', fileName: asset.target, source: readFileSync(asset.source) });
      }
    },
    configureServer(server) {
      for (const asset of brandAssets) {
        server.middlewares.use(`/${asset.target}`, (_request, response) => {
          if (!existsSync(asset.source)) return void response.writeHead(404).end();
          response.setHeader('Content-Type', asset.target.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
          response.end(readFileSync(asset.source));
        });
      }
    },
  };
}

const CURSOR_VARIABLES: Record<string, string> = {
  pointer: 'var(--ui-cursor-pointer, pointer)',
  default: 'var(--ui-cursor-default, default)',
};
function cursorVariables() {
  return {
    postcssPlugin: 'ochag-cursor-variables',
    Declaration: {
      cursor(declaration: { value: string }) {
        const value = CURSOR_VARIABLES[declaration.value.trim().replace(/\s*!important$/, '')];
        if (value) declaration.value = declaration.value.includes('!important') ? `${value} !important` : value;
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), brandingImages()],
  css: { postcss: { plugins: [cursorVariables()] } },
  build: {
    rollupOptions: {
      // Phone entry: must not pull in App.vue/PlayerViewApp.vue and with them Babylon.js.
      input: {
        main: here('index.html'),
        phone: here('phone.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
      '/live': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
});
