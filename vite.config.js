import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages 프로젝트 사이트는 https://<user>.github.io/<repo>/ 하위 경로에서 서비스됨
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/checklist-app/' : '/',
  plugins: [react()],
  build: {
    minify: false,
    emptyOutDir: false,
  },
}))
