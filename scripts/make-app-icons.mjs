// Turns the app icon artwork (assets/icon-source.webp) into the source PNGs
// that `capacitor-assets generate` makes every Android icon and splash size
// from, and into the website's favicon. Run with `npm run icons`.

import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SIZE = 1024
const SPLASH = 2732
const ASSETS = new URL('../assets/', import.meta.url)
const path = (name, base = ASSETS) => fileURLToPath(new URL(name, base))

// The artwork is a rounded square drawn on a grey backdrop. This is the
// square it sits in, in pixels of the source image.
const ARTWORK = { left: 50, top: 48, width: 1154, height: 1154 }
// Corner radius of that rounded square once scaled to SIZE, taken slightly
// large so none of the grey backdrop survives in the corners.
const CORNER = 215
// Android launchers only show the middle two thirds of an icon layer. Drawn a
// little smaller than the layer, more of the picture lands inside that part.
const LAUNCHER_SCALE = 0.84

const BLACK = '#000000'
const PAPER = '#f6f3ec'

const roundedMask = (size, radius) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}"/></svg>`)

const solid = (size, color) => sharp({ create: { width: size, height: size, channels: 4, background: color } })

/** The artwork alone: square, with everything outside its rounded corners transparent. */
async function artwork(size) {
  return sharp(path('icon-source.webp'))
    .extract(ARTWORK)
    .resize(size, size)
    .composite([{ input: roundedMask(size, (CORNER * size) / SIZE), blend: 'dest-in' }])
    .png()
    .toBuffer()
}

/** The artwork centred on a plain square of `canvas` pixels. */
async function centred(canvas, color, artSize) {
  const at = Math.round((canvas - artSize) / 2)
  return solid(canvas, color)
    .composite([{ input: await artwork(artSize), left: at, top: at }])
    .png()
    .toBuffer()
}

await Promise.all([
  // Older launchers show this one as it is.
  sharp(await centred(SIZE, BLACK, SIZE)).toFile(path('icon-only.png')),
  // Newer launchers cut their own shape out of the foreground laid over the background.
  sharp(await centred(SIZE, BLACK, Math.round(SIZE * LAUNCHER_SCALE))).toFile(path('icon-foreground.png')),
  solid(SIZE, BLACK).png().toFile(path('icon-background.png')),
  // The icon in the middle of a plain screen, for the moment the app starts.
  sharp(await centred(SPLASH, PAPER, 720)).toFile(path('splash.png')),
  sharp(await centred(SPLASH, BLACK, 720)).toFile(path('splash-dark.png')),
  sharp(await artwork(192)).toFile(path('../public/favicon.png')),
])
console.log('Wrote icon and splash sources to assets/ and public/favicon.png')
