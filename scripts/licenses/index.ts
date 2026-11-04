import { readFileSync, writeFileSync } from 'node:fs';
import { assertCurrent, renderNotices } from './notices.js';

const root = process.cwd();
const notices = renderNotices(root);
if (process.argv.includes('--write')) {
  writeFileSync('THIRD_PARTY_NOTICES', notices);
} else {
  assertCurrent(readFileSync('THIRD_PARTY_NOTICES', 'utf8'), notices);
  console.log('Production licenses allowed; THIRD_PARTY_NOTICES is current.');
}
