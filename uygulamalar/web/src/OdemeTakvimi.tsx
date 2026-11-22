import { useEffect, useState, type ReactNode } from 'react';
import { istek } from './api';
import { eur } from './bicim';

const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;
function useYap(yenile: () => unknown) {
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yap = async (f: () => Promise<any>, tamam?: string) => { setHata(''); setNot(''); try { const r = await f(); if (tamam) setNot(tamam); await yenile(); return r; } catch (x) { setHata((x as Error).message); } };
  const Mesaj = () => <>{hata && <div className="hata" role="alert">{hata}</div>}{not && <div className="not" role="status">{not}</div>}</>;
  return { yap, Mesaj };
}

type Satir = { kaynak: string; aciklama: string; tutar_eur: number | null; tutar_tl: number | null; vade: string; kimlik?: string };
const tr = (t: string) => t.split('-').reverse().join('.');

/** YG-918: ön muhasebe ödeme takvimi; masraf 7'si/21'i, maaş izleyen ayın ilk iş günü; vergi, SGK ve diğer ödemeler elle girilir. */
export function OdemeTakvimi() {
  const [v, setV] = useState<{ satirlar: Satir[]; oneri: { masraf: string; maas: string } } | null>(null);
  const [f, setF] = useState({ tur: 'Vergi', aciklama: '', tutarTl: '', vade: '' });
  const yukle = () => istek<NonNullable<typeof v>>('/odeme-takvimi').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  if (!v) return null;
  return (
    <Blok baslik="Ödeme Takvimi"><Mesaj />
      <div className="not">Önerilen vade · Personel masrafı: {tr(v.oneri.masraf)} · Maaş: {tr(v.oneri.maas)}</div>
      <div className="tablo" data-t="odeme-takvimi"><table className="kartli"><thead><tr><th>Vade</th><th>Tür</th><th>Açıklama</th><th>Tutar</th><th></th></tr></thead>
        <tbody>{v.satirlar.map((s, n) => <tr key={`${s.kaynak}-${s.kimlik ?? n}`}><td data-ad="Vade">{tr(s.vade)}</td><td data-ad="Tür">{s.kaynak}</td><td data-ad="Açıklama">{s.aciklama}</td>
          <td data-ad="Tutar">{s.tutar_eur !== null ? eur(s.tutar_eur) : s.tutar_tl !== null ? `${s.tutar_tl.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL` : '—'}</td>
          <td>{['Vergi', 'SGK', 'Diğer'].includes(s.kaynak) && s.kimlik && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/odeme-takvimi/kalem/${s.kimlik}/odendi`, {}), 'Ödeme kaydedildi.')}>Ödendi</button>}</td></tr>)}</tbody></table></div>
      <label htmlFor="ot-t">Ödeme Türü</label><select id="ot-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Vergi', 'SGK', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="ot-a">Ödeme Açıklaması</label><input required id="ot-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      <label htmlFor="ot-u">Tutar (TL)</label><input id="ot-u" inputMode="decimal" value={f.tutarTl} onChange={(e) => setF({ ...f, tutarTl: e.target.value })} />
      <label htmlFor="ot-v">Vade</label><input required id="ot-v" type="date" value={f.vade} onChange={(e) => setF({ ...f, vade: e.target.value })} />
      <button className="btn2" disabled={!f.aciklama.trim() || !f.vade} onClick={() => void yap(() => istek('/odeme-takvimi/kalem', { tur: f.tur, aciklama: f.aciklama, vade: f.vade, tutarTl: f.tutarTl ? Number(f.tutarTl.replace(/\./g, '').replace(',', '.')) : undefined }).then(() => setF({ tur: f.tur, aciklama: '', tutarTl: '', vade: '' })), 'Ödeme takvime eklendi.')}>Takvime Ekle</button>
    </Blok>
  );
}
