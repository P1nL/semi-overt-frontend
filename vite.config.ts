import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// This repository is for local microservices demos; production has a separate checkout.
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:18080'

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'lord-icon',
        },
      },
    }),
    tailwindcss(),
  ],
  optimizeDeps: {
    include: ['gsap', 'gsap/dist/Flip'],
  },
  server: {
    host: '127.0.0.1',
    port: 15173,
    strictPort: true,
    proxy: {
      '/api': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/static': {
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
