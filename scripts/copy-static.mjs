import { cpSync, copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist/image-studio', { recursive: true })
cpSync('assets', 'dist/assets', { recursive: true })
cpSync('image-studio/assets', 'dist/image-studio/assets', { recursive: true })

for (const file of ['aup.html', 'pricing.html', 'privacy.html', 'terms.html', 'legal.css']) {
  copyFileSync(file, `dist/${file}`)
}
