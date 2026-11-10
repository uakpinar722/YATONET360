// Örnek rapor çıktısı (geliştirme veritabanından): tsx araclar/rapor_ornek.ts <hedef dizin>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ortamOku } from '../src/ayarlar.js';
import { ceoRaporuTanim, yonetimRaporuTanim } from '../src/rapor_belge.js';
import { pdfUret } from '../src/pdf.js';
import { docxUret } from '../src/docx.js';
const e = ortamOku(); const db = new pg.Pool({ host: 'localhost', user: 'postgres', password: e.POSTGRES_SUPER_PAROLA, database: 'yatonet360' });
const d = process.argv[2]!; const donem = '2026-10';
for (const [ad, t] of [['ceo', await ceoRaporuTanim(db, donem)], ['rp-tic-002', await yonetimRaporuTanim(db, donem)]] as const) { writeFileSync(join(d, `${ad}.pdf`), await pdfUret(t)); writeFileSync(join(d, `${ad}.docx`), docxUret(t)); }
await db.end(); console.log('tamam');
