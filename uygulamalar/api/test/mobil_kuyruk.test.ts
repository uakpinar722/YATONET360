import { describe, expect, it } from 'vitest';
import { CevrimdisiKuyruk, type EsitlemeSonucu, type KuyrukDeposu, type KuyrukKaydi } from '../../../mobil/src/cevrimdisi.js';

const bellek = (): KuyrukDeposu & { m: Map<string, KuyrukKaydi> } => { const m = new Map<string, KuyrukKaydi>(); return { m, hepsi: async () => [...m.values()], yaz: async (k) => { m.set(k.kimlik, k); }, sil: async (k) => { m.delete(k); } }; };
let n = 0; const id = () => `k${++n}`;

describe('çevrimdışı kuyruk (YG-494)', () => {
  it('bağlantı yokken kayıt kalır, gelince gider ve silinir', async () => {
    const d = bellek(); let acik = false; const giden: string[] = [];
    const q = new CevrimdisiKuyruk(d, async (l) => { if (!acik) throw new Error('yok'); giden.push(...l.map((x) => x.kimlik)); return l.map((x) => ({ kimlik: x.kimlik, durum: 'Uygulandı' as const })); }, id);
    const a = await q.ekle('/y', { x: 1 }); expect((await q.esitle()).bagliDegil).toBe(true); expect(await q.bekleyenSayisi()).toBe(1);
    acik = true; await q.esitle(); expect(giden).toEqual([a]); expect(await q.bekleyenSayisi()).toBe(0);
  });
  it('çakışma ve ret saklanır, kullanıcı görmeden silinmez', async () => {
    const d = bellek(); const q = new CevrimdisiKuyruk(d, async (l) => l.map((x, i): EsitlemeSonucu => ({ kimlik: x.kimlik, durum: i === 0 ? 'Çakışma' : 'Reddedildi', hata: 'H' })), id);
    await q.ekle('/a', {}); await q.ekle('/b', {}); await q.esitle();
    const s = await q.sorunlular(); expect(s.map((x) => x.durum).sort()).toEqual(['Reddedildi', 'Çakışma'].sort()); expect(await q.bekleyenSayisi()).toBe(0);
    await q.esitle(); expect((await q.sorunlular()).length).toBe(2);
    await q.vazgec(s[0]!.kimlik); expect((await q.sorunlular()).length).toBe(1);
  });
  it('elli kayıtlık parçalar halinde gönderir', async () => {
    const d = bellek(); const b: number[] = []; const q = new CevrimdisiKuyruk(d, async (l) => { b.push(l.length); return l.map((x) => ({ kimlik: x.kimlik, durum: 'Uygulandı' as const })); }, id);
    for (let i = 0; i < 120; i++) await q.ekle('/a', {}); await q.esitle(); expect(b).toEqual([50, 50, 20]);
  });
});
