/**
 * Rasterizes public/icon.svg into the PNG icons referenced by the web manifest.
 * Run with: bun scripts/generate-icons.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

async function main() {
  const svg = readFileSync(join(process.cwd(), 'public/icon.svg'));
  const outDir = join(process.cwd(), 'public/icons');
  mkdirSync(outDir, { recursive: true });

  // Standard app icons.
  for (const size of [192, 512]) {
    const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    writeFileSync(join(outDir, `icon-${size}.png`), png);
    console.log(`icon-${size}.png written (${png.length} bytes)`);
  }

  // Maskable icon: same art inset on a full-bleed background so Android can
  // crop it to any mask shape without clipping the cap.
  const inset = Buffer.from(
    readFileSync(join(process.cwd(), 'public/icon.svg'), 'utf8').replace(
      'rx="112"',
      'rx="0"',
    ),
  );
  const inner = await sharp(inset, { density: 384 }).resize(384, 384).png().toBuffer();
  const maskable = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 10, g: 26, b: 62, alpha: 1 } },
  })
    .composite([{ input: inner, gravity: 'centre' }])
    .png()
    .toBuffer();
  writeFileSync(join(outDir, 'maskable-512.png'), maskable);
  console.log(`maskable-512.png written (${maskable.length} bytes)`);

  // Apple touch icon (iOS home screen) — 180x180, opaque background.
  const apple = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer();
  writeFileSync(join(outDir, 'apple-touch-icon.png'), apple);
  console.log(`apple-touch-icon.png written (${apple.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
