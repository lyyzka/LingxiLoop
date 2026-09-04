import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const repository = path.resolve(__dirname, '..')

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': path.join(repository, 'src') },
    dedupe: [
      'react',
      'react-dom',
      '@assistant-ui/react',
      '@assistant-ui/core',
      '@assistant-ui/store',
      'yjs',
      'y-prosemirror',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
    ],
  },
  css: { postcss: path.join(repository, 'postcss.config.js') },
  server: {
    host: '127.0.0.1',
    port: 5192,
    strictPort: true,
    fs: { allow: [repository] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined) } },
  },
})
