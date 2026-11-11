import { useEffect, useState } from 'react';
import { istek } from './api';
import { DosyaBag } from './DosyaBag';

type Is = { kimlik: string; is_emri_no?: string; siparis_no?: string; dosya_no: string; yat_adi: string; cozum_ortagi?: string | null; tedarikci?: string; brans?: string | null; sorumlu: string | null; baslangic?: string | null; hedef?: string | null; teslim_tarihi?: string; tamamlanma?: string | null; teslim_zamani?: string | null; gecikti?: boolean };
type L = { tur: string; tamamlanan: Is[]; devamEden: Is[]; planli: Is[]; ortalamaKesifDakika: number | null };
const t = (s?: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('tr-TR') : '');
const satir = (x: Is, tarih: string) => <div className={x.gecikti ? 'soru hata' : 'soru'} key={x.kimlik}><span><DosyaBag no={x.dosya_no} /> · {x.yat_adi}{x.is_emri_no ? ` · ${x.is_emri_no}` : ''}{x.siparis_no ? ` · ${x.siparis_no}` : ''}{x.cozum_ortagi ? ` · ${x.cozum_ortagi}` : ''}{x.tedarikci ? ` · ${x.tedarikci}` : ''}{x.brans ? ` · ${x.brans}` : ''}{x.sorumlu ? ` · ${x.sorumlu}` : ''}{tarih ? ` · ${tarih}` : ''}{x.gecikti ? ' · Hedef tarihi geçti' : ''}</span></div>;
/** YG-814–818: Tamamlanan, Devam Eden ve Planlı İşler; tedarik kolunda siparişler. */
export function IsListeleri() {
  const [v, setV] = useState<L | null>(null);
  useEffect(() => { void istek<L>('/is-listeleri').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const s = v.tur === 'Sipariş';
  const belirli = v.planli.filter((x) => x.baslangic || x.teslim_tarihi); const belirsiz = v.planli.filter((x) => !x.baslangic && !x.teslim_tarihi);
  return <details><summary>{s ? 'Siparişler' : 'İşler'} · {v.devamEden.length} devam ediyor{v.ortalamaKesifDakika ? ` · Ortalama keşif süresi ${v.ortalamaKesifDakika} dk` : ''}</summary>
    <div className="bolum">{s ? 'Teslim Edilen Siparişler (Son 72 Saat)' : 'Tamamlanan İşler (Son 72 Saat)'}</div>{v.tamamlanan.length ? v.tamamlanan.map((x) => satir(x, t(x.tamamlanma ?? x.teslim_zamani))) : <div className="ozet bos">Kayıt bulunmamaktadır.</div>}
    <div className="bolum">{s ? 'Devam Eden Siparişler' : 'Devam Eden İşler'}</div>{v.devamEden.length ? v.devamEden.map((x) => satir(x, t(x.hedef ?? x.teslim_tarihi))) : <div className="ozet bos">Kayıt bulunmamaktadır.</div>}
    <div className="bolum">{s ? 'Planlı Siparişler' : 'Planlı İşler'}</div>{belirli.map((x) => satir(x, t(x.baslangic ?? x.teslim_tarihi)))}
    {belirsiz.length > 0 && <><div className="not">Tarih Belirsiz</div>{belirsiz.map((x) => satir(x, ''))}</>}
    {!v.planli.length && <div className="ozet bos">Kayıt bulunmamaktadır.</div>}</details>;
}

/** YG-812: 7 günlük planlanan konum tablosu. */
export function KonumPlani() {
  const [v, setV] = useState<{ kisiler: { kimlik: string; ad: string; gunler: { tarih: string; konum: string }[] }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/konum-plani').then(setV).catch(() => setV(null)); }, []);
  if (!v?.kisiler.length) return null;
  const gun = v.kisiler[0]!.gunler.map((g) => new Date(`${g.tarih}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'numeric' }));
  return <details><summary>7 Günlük Konum Planı</summary><div style={{ overflowX: 'auto' }}><table><thead><tr><th>Personel</th>{gun.map((g) => <th key={g}>{g}</th>)}</tr></thead>
    <tbody>{v.kisiler.map((k) => <tr key={k.kimlik}><td>{k.ad}</td>{k.gunler.map((g) => <td key={g.tarih}>{g.konum}</td>)}</tr>)}</tbody></table></div></details>;
}

type H = { bolgeler: { bolge: string; devamEden: number; beklemede: number; oncelik: Record<string, number> }[]; dosyalar: { kimlik: string; dosyaNo: string; statu: string; oncelik: string; sorumlu: string | null; sonIslem: string; hedef: string | null; bolge: string | null; enlem: number; boylam: number }[] };
const RENK: Record<string, string> = { Kritik: '#d22d2d', Yüksek: '#f08a24', Normal: '#2f6fd6', Planlı: '#8a8f96' };
/** YG-810, YG-811: dosya haritası; bölge özeti ve dosya özet kartı. */
export function DosyaHaritasi() {
  const [v, setV] = useState<H | null>(null); const [b, setB] = useState<string | null>(null);
  useEffect(() => { void istek<H>('/dosya-haritasi').then(setV).catch(() => setV(null)); }, []);
  if (!v || !v.bolgeler.length) return null;
  const E = [35.8, 42.2], B = [25.6, 45]; const W = 600, Hh = 260;
  const xy = (e: number, bo: number) => [((bo - B[0]!) / (B[1]! - B[0]!)) * W, Hh - ((e - E[0]!) / (E[1]! - E[0]!)) * Hh];
  const sec = v.bolgeler.find((x) => x.bolge === b);
  return <details><summary>Dosya Haritası</summary>
    <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: '100%', maxWidth: W, background: '#eef4fa' }} role="img" aria-label="Dosya haritası">{v.dosyalar.map((d) => { const [x, y] = xy(d.enlem, d.boylam); return <circle key={d.kimlik} cx={x} cy={y} r={6} fill={RENK[d.oncelik] ?? '#2f6fd6'} onClick={() => setB(d.bolge)}><title>{`${d.dosyaNo} · ${d.statu} · ${d.oncelik}${d.sorumlu ? ` · ${d.sorumlu}` : ''} · Son işlem ${t(d.sonIslem)}${d.hedef ? ` · Hedef ${t(d.hedef)}` : ''}`}</title></circle>; })}</svg>
    <div className="tam">{v.bolgeler.map((x) => <button key={x.bolge} className="btn2 kucuk" onClick={() => setB(x.bolge)}>{x.bolge} ({x.devamEden})</button>)}</div>
    {sec && <div className="ozet"><b>{sec.bolge}</b> · Devam eden: {sec.devamEden} · Beklemede: {sec.beklemede} · {Object.entries(sec.oncelik).map(([k, n]) => `${k}: ${n}`).join(', ')}</div>}</details>;
}
