import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const VARSAYILAN = process.env.YATONET_DEPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.veri', 'belgeler');

export class BoyutAsimi extends Error {}

/** Yerel klasörde içerik adresli depo. Üretimde nesne depolama aynı arayüzle bağlanır (YG-1270). Aynı içerik tek kopya, üzerine yazma yoktur. */
export class Depo {
  constructor(readonly kok = VARSAYILAN) { mkdirSync(join(kok, 'gecici'), { recursive: true }); }

  /** Akışı geçici dosyaya yazar, özetini ve boyutunu çıkarır. Sınır aşılırsa geçici dosya bırakılmaz. */
  async al(akis: Readable, azami: number): Promise<{ yol: string; boyut: number; ozet: string }> {
    const yol = join(this.kok, 'gecici', randomUUID());
    const h = createHash('sha256'); const c = createWriteStream(yol); let boyut = 0;
    try {
      for await (const p of akis as AsyncIterable<Buffer>) {
        boyut += p.length;
        if (boyut > azami) throw new BoyutAsimi();
        h.update(p);
        if (!c.write(p)) await new Promise<void>((r) => c.once('drain', () => r()));
      }
      await new Promise<void>((r, x) => c.end((e?: Error | null) => (e ? x(e) : r())));
      return { yol, boyut, ozet: h.digest('hex') };
    } catch (e) { c.destroy(); gecisiciSil(yol); throw e; }
  }
  /** Taranan geçici dosyayı kalıcı yere taşır. */
  yerlestir(gecici: string, ozet: string): string {
    const anahtar = `${ozet.slice(0, 2)}/${ozet.slice(2, 4)}/${ozet}`;
    const hedef = join(this.kok, anahtar);
    if (existsSync(hedef)) gecisiciSil(gecici);
    else { mkdirSync(dirname(hedef), { recursive: true }); renameSync(gecici, hedef); }
    return anahtar;
  }
  bagla(anahtar: string): Readable { return createReadStream(join(this.kok, anahtar)); }
  vazgec(gecici: string) { gecisiciSil(gecici); }
}

function gecisiciSil(yol: string) { rmSync(yol, { force: true }); }

export function basiniOku(yol: string, n = 16): Buffer {
  const f = openSync(yol, 'r');
  try { const b = Buffer.alloc(n); const o = readSync(f, b, 0, n, 0); return b.subarray(0, o); } finally { closeSync(f); }
}

/** YG-1269: çalıştırılabilir dosya uzantısı değiştirilse de yüklenemez; içerik uzantıyla uyuşmalıdır. */
export function icerikHatasi(uzanti: string, b: Buffer): string | null {
  const bas = (...x: number[]) => x.every((v, i) => b[i] === v);
  if (bas(0x4d, 0x5a) || bas(0x7f, 0x45, 0x4c, 0x46) || bas(0x23, 0x21)) return 'Çalıştırılabilir dosya yüklenemez.';
  const ftyp = b.subarray(4, 8).toString('latin1') === 'ftyp';
  const zip = bas(0x50, 0x4b, 0x03, 0x04) || bas(0x50, 0x4b, 0x05, 0x06);
  const uygun: Record<string, boolean> = {
    jpg: bas(0xff, 0xd8, 0xff), jpeg: bas(0xff, 0xd8, 0xff), png: bas(0x89, 0x50, 0x4e, 0x47), heic: ftyp, mp4: ftyp, mov: ftyp || b.subarray(4, 8).toString('latin1') === 'moov',
    dng: bas(0x49, 0x49, 0x2a, 0x00) || bas(0x4d, 0x4d, 0x00, 0x2a), pdf: b.subarray(0, 5).toString('latin1') === '%PDF-', docx: zip, xlsx: zip, zip,
    dwg: b.subarray(0, 2).toString('latin1') === 'AC', dxf: !b.includes(0), txt: !b.includes(0),
  };
  return uygun[uzanti] ? null : 'Dosyanın içeriği uzantısıyla uyuşmamaktadır.';
}

export interface Tarayici { ad: string; temizMi(yol: string): Promise<boolean> }

/**
 * Antivirüs bağlanana kadar kullanılan deneme tarayıcısı: yalnız standart EICAR sınama imzasını yakalar, gerçek zararlıları yakalamaz.
 * Kayıtta kaynağı "Deneme" yazar; üretim açılışında bu dosyalar gerçek tarayıcıdan geçirilir.
 */
export const denemeTarayici: Tarayici = {
  ad: 'Deneme',
  async temizMi(yol) {
    const b = basiniOku(yol, 4096).toString('latin1');
    return !b.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
  },
};
