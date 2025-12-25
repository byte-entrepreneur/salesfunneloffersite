import fs from 'fs';
import path from 'path';

const root = path.resolve('..'); // backend folder is inside myfreedomTrader_sites/backend
const src = path.join(root, '');
const dest = path.join(process.cwd(), 'public');

if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

const files = [
  '../ebookLandingPage.html',
  '../ebookBuy.html',
  '../thankyou.html',
  '../styles.css',
  '../js/ebookBuy.js',
  "../Freedom%20Trader's%20blueprint%20mockup.png"
];

files.forEach(f => {
  const from = path.resolve(process.cwd(), f);
  const to = path.join(dest, path.basename(f));
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
    console.log('copied', from, '->', to);
  } else {
    console.warn('missing', from);
  }
});

console.log('sync complete');
