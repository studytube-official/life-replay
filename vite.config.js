import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://zkquchdaizdjrvlsncbs.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
].join('; ')

// Vite devはReact Refresh用のインラインスクリプトを挿入するため、
// 厳格なCSPはGitHub Pagesへ出す本番ビルドだけに注入する。
const productionCsp = () => ({
  name: 'production-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'pre',
    handler: () => [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
      injectTo: 'head',
    }],
  },
})

export default defineConfig({
  plugins: [react(), productionCsp()],
  // カスタムドメイン jibunq.com のルート直下で配信するため base は '/'
  // (旧 studytube-official.github.io/life-replay/ はGitHubが自動でjibunq.comへ転送)
  base: '/',
  server: { port: 5175 },
})
