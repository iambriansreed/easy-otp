/**
 * Generates build/icon.icns from assets/icon.svg.
 *
 * Prerequisites:
 *   - macOS (requires the built-in `iconutil` command)
 *   - Node.js 18+
 *   - npm install (sharp must be installed)
 *
 * Usage:
 *   npm run make-icons
 *   — or —
 *   npx tsx scripts/make-icons.ts
 *
 * Input:  assets/icon.svg  (place your SVG here before running)
 * Output: build/icon.icns  (used by electron-builder for the app icon)
 */

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

async function main() {
    const svg = path.resolve('assets/icon.svg');

    if (!fs.existsSync(svg)) {
        console.error('Error: assets/icon.svg not found.');
        console.error('Place your SVG file at assets/icon.svg and re-run this script.');
        process.exit(1);
    }
    const iconset = path.resolve('build/MyIcon.iconset');
    const out = path.resolve('build/icon.icns');

    fs.mkdirSync(iconset, { recursive: true });

    // Render SVG once at high density to a large PNG buffer, then resize from that
    const source = await sharp(svg, { density: 600 })
        .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    const sizes = [
        { file: 'icon_16x16.png', size: 16 },
        { file: 'icon_16x16@2x.png', size: 32 },
        { file: 'icon_32x32.png', size: 32 },
        { file: 'icon_32x32@2x.png', size: 64 },
        { file: 'icon_128x128.png', size: 128 },
        { file: 'icon_128x128@2x.png', size: 256 },
        { file: 'icon_256x256.png', size: 256 },
        { file: 'icon_256x256@2x.png', size: 512 },
        { file: 'icon_512x512.png', size: 512 },
        { file: 'icon_512x512@2x.png', size: 1024 },
    ];

    for (const { file, size } of sizes) {
        await sharp(source)
            .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(path.join(iconset, file));
        console.log(`  ${file}`);
    }

    execSync(`iconutil -c icns "${iconset}" -o "${out}"`);
    console.log(`\nDone → ${out}`);
}

main();
