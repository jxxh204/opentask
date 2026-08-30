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
        koMain: r('ko/index.html'),
        koDownload: r('ko/download.html'),
        koDocs: r('ko/docs.html'),
        koChangelog: r('ko/changelog.html'),
      },
    },
  },
})
