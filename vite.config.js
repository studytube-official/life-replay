import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // カスタムドメイン jibunq.com のルート直下で配信するため base は '/'
  // (旧 studytube-official.github.io/life-replay/ はGitHubが自動でjibunq.comへ転送)
  base: '/',
  server: { port: 5175 },
})
