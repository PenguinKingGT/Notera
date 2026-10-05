/** Build the isolated desktop processes and locally bundled notation worker with a development-only HMR CSP. */
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          'pdf-worker': fileURLToPath(
            new URL('./src/main/pdf-worker.ts', import.meta.url),
          ),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src/renderer', import.meta.url)) },
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'development-csp',
        /** Permit Vite injection and its local socket only while serving development HTML. */
        transformIndexHtml(html, context) {
          if (!context.server) {
            return html
          }
          return html
            .replace(
              "script-src 'self' 'wasm-unsafe-eval';",
              "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline';",
            )
            .replace(
              "connect-src 'self'",
              "connect-src 'self' ws://127.0.0.1:5173",
            )
        },
      },
    ],
  },
})
