// YG-1128: kurulu kütüphanelerin lisans listesi; ticari kullanıma uygun görünmeyenleri işaretler.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const UYGUN = /^(\(?)(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|CC0-1\.0|OFL-1\.1|Python-2\.0|Unlicense|MPL-2\.0|CC-BY-4\.0)\b/;
const kok = join(import.meta.dirname, '..', 'node_modules');
const say = new Map(); const sorun = [];
function bak(klasor) {
  for (const a of readdirSync(klasor)) {
    if (a.startsWith('.')) continue;
    if (a.startsWith('@')) { bak(join(klasor, a)); continue; }
    const p = join(klasor, a, 'package.json');
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const l = typeof j.license === 'string' ? j.license : j.license?.type ?? 'BELİRSİZ';
    say.set(l, (say.get(l) ?? 0) + 1);
    if (!UYGUN.test(l)) sorun.push(`${j.name}@${j.version}: ${l}`);
  }
}
bak(kok);
console.log([...say].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}: ${n}`).join('\n'));
console.log(sorun.length ? '\nİNCELENECEK:\n' + sorun.join('\n') : '\nİncelenecek lisans yok.');
