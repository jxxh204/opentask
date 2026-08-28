import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: r('index.html'),
        download: r('download.html'),
        docs: r('docs.html'),
        changelog: r('changelog.html'),
        enMain: r('en/index.html'),
        enDownload: r('en/download.html'),
        enDocs: r('en/docs.html'),
        enChangelog: r('en/changelog.html'),
      },
    },
  },
})
