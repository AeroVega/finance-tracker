// Development only: npm install --prefix /tmp/finance-icon-tools sharp
// NODE_PATH=/tmp/finance-icon-tools/node_modules node scripts/generate-app-icons.mjs
// Committed PNGs are served directly. No runtime or application build dependency.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const source = new URL('../assets/icons/finance-tracker.svg', import.meta.url);
for (const [size, name] of [[180, 'apple-touch-icon'], [192, 'icon-192'], [512, 'icon-512']]) {
  await sharp(source.pathname).resize(size, size).flatten({background:'#09090b'})
    .removeAlpha().png().toFile(new URL(`../assets/icons/${name}.png`, import.meta.url).pathname);
}
