import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Версия приложения — из package.json, а не переписанная руками во втором
// месте: две версии рано или поздно разъезжаются, и «О приложении» начинает
// врать. Показывает её экран About.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  }
})
