// Draws the Sunspot app icon and writes the source PNGs that
// `capacitor-assets generate` turns into every Android icon and splash size.
// Run with `npm run icons`.
//
// The icon is the app in one picture: a sun, a building seen from above, and
// the blue shade the building throws away from the sun.

import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SIZE = 1024
const SPLASH = 2732
const OUT = new URL('../assets/', import.meta.url)

const NIGHT = '#16203c'
const PAPER = '#f6f3ec'

const background = `
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b3d6b"/>
      <stop offset="1" stop-color="${NIGHT}"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>`

// Everything sits inside the middle two thirds of the square, the part an
// Android launcher never crops, whatever shape it cuts the icon to.
const foreground = `
  <path d="M520 650 615 745H765V595L670 500V650Z" fill="#3f63e0" stroke="#0b1c63" stroke-width="14" stroke-linejoin="round"/>
  <rect x="520" y="500" width="150" height="150" rx="14" fill="#f3ecdd" stroke="#0b1c63" stroke-width="14"/>
  <g stroke="#ffc21f" stroke-width="26" stroke-linecap="round">
    <path d="M390 235v40M390 505v40M235 390h40M505 390h40M280 280l28 28M472 472l28 28M500 280l-28 28M308 472l-28 28"/>
  </g>
  <circle cx="390" cy="390" r="92" fill="#ffc21f" stroke="#fff3c4" stroke-width="12"/>`

const svg = (body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`,
  )

/** The icon in the middle of a plain screen, for the moment the app starts. */
const splash = (fill) => {
  const logo = 720
  const at = (SPLASH - logo) / 2
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPLASH}" height="${SPLASH}" viewBox="0 0 ${SPLASH} ${SPLASH}">
      <rect width="${SPLASH}" height="${SPLASH}" fill="${fill}"/>
      <svg x="${at}" y="${at}" width="${logo}" height="${logo}" viewBox="0 0 ${SIZE} ${SIZE}">
        <clipPath id="round"><rect width="${SIZE}" height="${SIZE}" rx="230"/></clipPath>
        <g clip-path="url(#round)">${background}${foreground}</g>
      </svg>
    </svg>`,
  )
}

await mkdir(OUT, { recursive: true })
const write = (name, buffer) => sharp(buffer).png().toFile(fileURLToPath(new URL(name, OUT)))

await Promise.all([
  write('icon-only.png', svg(background + foreground)),
  write('icon-background.png', svg(background)),
  write('icon-foreground.png', svg(foreground)),
  write('splash.png', splash(PAPER)),
  write('splash-dark.png', splash(NIGHT)),
])
console.log('Wrote icon and splash sources to assets/')
