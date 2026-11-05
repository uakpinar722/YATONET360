import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const VARSAYILAN = process.env.YATONET_DEPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.veri', 'belgeler');

export class BoyutAsimi extends Error {}

let KRITIK_ANAHTAR: Buffer | null = null;
export const kritikAnahtari = (a: string) => { KRITIK_ANAHTAR = createHash('sha256').update(`${a}:kritik-belge`).digest(); };

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
    } catch (e) { await new Promise<void>((r) => { c.once('close', () => r()); c.destroy(); }); gecisiciSil(yol); throw e; }
  }
  /** Taranan geçici dosyayı kalıcı yere taşır. */
  yerlestir(gecici: string, ozet: string): string {
    const anahtar = `${ozet.slice(0, 2)}/${ozet.slice(2, 4)}/${ozet}`;
    const hedef = join(this.kok, anahtar);
    if (existsSync(hedef)) gecisiciSil(gecici);
    else { mkdirSync(dirname(hedef), { recursive: true }); renameSync(gecici, hedef); }
    return anahtar;
  }
  /** DEP-1a: Kritik belge diskte AES-256-GCM ile şifreli durur; aynı içerik başka belgeyle paylaşılmaz. */
  yerlestirKritik(gecici: string, ozet: string): string {
    if (!KRITIK_ANAHTAR) throw new Error('Kritik belge anahtarı tanımsız');
    const anahtar = `kritik/${ozet}-${randomUUID()}`; const hedef = join(this.kok, anahtar); const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', KRITIK_ANAHTAR, iv); const g = Buffer.concat([c.update(readFileSync(gecici)), c.final()]);
    mkdirSync(dirname(hedef), { recursive: true }); writeFileSync(hedef, Buffer.concat([iv, c.getAuthTag(), g])); gecisiciSil(gecici);
    return anahtar;
  }
  bagla(anahtar: string): Readable {
    if (!anahtar.startsWith('kritik/')) return createReadStream(join(this.kok, anahtar));
    if (!KRITIK_ANAHTAR) throw new Error('Kritik belge anahtarı tanımsız');
    const v = readFileSync(join(this.kok, anahtar)); const d = createDecipheriv('aes-256-gcm', KRITIK_ANAHTAR, v.subarray(0, 12)); d.setAuthTag(v.subarray(12, 28));
    return Readable.from((function* () { yield Buffer.concat([d.update(v.subarray(28)), d.final()]); })());
  }
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
  if (bas(0x4d, 0x5a) || bas(0x7f, 0x45, 0x4c, 0x46) || bas(0x23, 0x21)) return 'Güvenliğiniz için çalıştırılabilir dosyalar alınmıyor; lütfen başka bir biçim seçiniz.';
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
