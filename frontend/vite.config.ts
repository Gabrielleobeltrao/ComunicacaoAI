import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * O `widget-loader.js` entregue com o endereço do BACKEND já dentro.
 *
 * O arquivo morava em `public/`, que o Vite copia sem tocar — então ele não tinha como
 * saber onde fica a API e usava a origem de onde foi servido. Em produção isso é o
 * frontend, cujo nginx não faz proxy de /api: o loader recebia o index.html no lugar do
 * JSON e o widget não montava. Não dava erro visível; simplesmente não aparecia.
 *
 * Aqui ele é processado: o marcador é trocado pelo mesmo `VITE_API_URL` que o resto do
 * app usa, e o resultado sai como `widget-loader.js` na raiz do dist — o mesmo endereço
 * de sempre, para o snippet já instalado nos clientes continuar funcionando.
 *
 * Script CLÁSSICO de propósito: ele é carregado por `<script src>` sem `type="module"`,
 * então não pode virar um módulo ES. Por isso é emitido como asset, e não como entrada
 * de bundle.
 */
function widgetLoaderPlugin(): Plugin {
  const origem = resolve(__dirname, 'src/widget-loader.js')
  return {
    name: 'comunicacaoai-widget-loader',
    apply: 'build',
    generateBundle() {
      const apiUrl = (process.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
      const fonte = readFileSync(origem, 'utf8')
      if (!fonte.includes('__API_ORIGIN__')) {
        // Se o marcador sumir numa edição, o loader volta a usar a origem do script — o
        // defeito silencioso de antes. Melhor falhar o build.
        this.error('widget-loader.js perdeu o marcador __API_ORIGIN__: o endereço da API não seria injetado')
      }
      this.emitFile({ type: 'asset', fileName: 'widget-loader.js', source: fonte.replaceAll('__API_ORIGIN__', apiUrl) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), widgetLoaderPlugin()],
  server: {
    // Pin to 5173 (the origin the backend / Better Auth trusts). Fail loudly if
    // it's taken instead of silently drifting to 5174 and breaking auth/CORS.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
