import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages配信時はサブパス /life-replay/ になる
  base: process.env.DEPLOY_TARGET === 'pages' ? '/life-replay/' : '/',
  server: { port: 5175 },
})
