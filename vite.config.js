import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const appBase = '/';

export default defineConfig({
  base: appBase,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().split('T')[0])
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'android-chrome-192x192.png',
        'android-chrome-512x512.png'
      ],
      manifest: {
        name: 'Osobní docházka',
        short_name: 'Docházka',
        description: 'Evidence osobní docházky s offline podporou a synchronizací',
        lang: 'cs',
        start_url: appBase,
        scope: appBase,
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          {
            src: 'android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
});
