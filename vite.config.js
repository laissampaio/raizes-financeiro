import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serve esse projeto em /raizes-financeiro/, nao na raiz do
  // dominio. So aplica em build de produção pra nao mudar o dev local.
  base: command === 'build' ? '/raizes-financeiro/' : '/',
}))
