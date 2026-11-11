import { useEffect, useState } from 'react';
import { istek } from './api';
import { DosyaBag } from './DosyaBag';

type O = { adet: number; medyan: number | null; p90: number | null; ortalama: number | null; gizli?: boolean };
type K = O & { grup: string };
type V = {
  filtre: { bas: string; son: string; kapsam: string }; uretim: string; asgariGrup: number;
  cevrim: { toplam: O; net: O }; kirilim: { hizmet: K[]; brans: K[]; oncelik: K[] };
  firma: { firma: string; dosya: number; endeks: number | null; durum: string }[] | null;
  egilim: { seri: { ay: string; acilan: number; kapanan: number; netMedyan: number | null }[]; kirilma: { ay: string; aciklama: string }[] };
  sapma: { dosyaNo: string; ilkPlan: number | null; onayliDegisiklik: number; degisiklikNedeni: string | null; fiili: number | null; aciklanamayan: number | null; sureSapmasiGun: number | null; onayliEkGun: number; beklenmeyenKosul: string | null }[];
};
const e = (x: number | null) => (x === null ? '—' : x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const o = (x: O) => (x.gizli ? `${x.adet} dosya · küçük grup, değer gösterilmez` : `${x.adet} dosya · medyan ${x.medyan ?? '—'} gün · %90'lık ${x.p90 ?? '—'} gün · ortalama ${x.ortalama ?? '—'} gün`);
/** YG-741, 746–748, 750, 756: süre analizi, kırılımlar, normalize firma karşılaştırması, eğilim ve sapma. */
export function Analiz() {
  const [v, setV] = useState<V | null>(null); const [f, setF] = useState({ bas: '', son: '' });
  const yk = () => istek<V>(`/analiz?bas=${f.bas}&son=${f.son}`).then((x) => { setV(x); setF({ bas: x.filtre.bas, son: x.filtre.son }); }).catch(() => setV(null));
  useEffect(() => { void yk(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return null;
  const tablo = (b: string, l: K[]) => <><div className="not">{b}</div>{l.map((x) => <div className="soru" key={x.grup}><span>{x.grup} · {o(x)}</span></div>)}</>;
  return <details><summary>Süre ve Sapma Analizi</summary>
    <div className="not">Kapsam: {v.filtre.kapsam} · {v.filtre.bas.split('-').reverse().join('.')} – {v.filtre.son.split('-').reverse().join('.')} · Üretim: {new Date(v.uretim).toLocaleString('tr-TR')}</div>
    <label htmlFor="an-b">Başlangıç</label><input id="an-b" type="date" value={f.bas} onChange={(x) => setF({ ...f, bas: x.target.value })} /><label htmlFor="an-s">Bitiş</label><input id="an-s" type="date" value={f.son} onChange={(x) => setF({ ...f, son: x.target.value })} /><button className="btn2 kucuk" onClick={() => void yk()}>Uygula</button>
    <div className="bolum">Çevrim Süresi</div><div className="soru"><span>Toplam geçen süre (yetkili duraklamalar dahil): {o(v.cevrim.toplam)}</span></div><div className="soru"><span>Net çalışma süresi: {o(v.cevrim.net)}</span></div>
    <div className="bolum">Kırılımlar (net süre)</div>{tablo('Hizmet türü', v.kirilim.hizmet)}{tablo('Branş', v.kirilim.brans)}{tablo('Öncelik', v.kirilim.oncelik)}
    {v.firma && <><div className="bolum">Firma Karşılaştırması (iş karışımına göre normalize)</div><div className="not">Endeks 1,0 = aynı branş ve öncelikteki dosyaların medyanı. En az {v.asgariGrup} dosyası olmayan firma sıralanmaz.</div>
      {v.firma.map((x) => <div className="soru" key={x.firma}><span>{x.firma} · {x.dosya} dosya · {x.endeks !== null ? `Endeks ${x.endeks.toLocaleString('tr-TR')}` : x.durum}</span></div>)}</>}
    <div className="bolum">Eğilim (son 12 ay)</div>{v.egilim.seri.map((x) => <div className="soru" key={x.ay}><span>{x.ay} · Açılan {x.acilan} · Kapanan {x.kapanan} · Net medyan {x.netMedyan ?? '—'} gün{v.egilim.kirilma.filter((k) => k.ay === x.ay).map((k) => ` · ▲ ${k.aciklama}`).join('')}</span></div>)}
    <div className="bolum">Maliyet ve Süre Sapması</div>{v.sapma.length ? v.sapma.map((x) => <div className={x.aciklanamayan && Math.abs(x.aciklanamayan) > 0.005 ? 'soru hata' : 'soru'} key={x.dosyaNo}><span><DosyaBag no={x.dosyaNo} /> · İlk plan {e(x.ilkPlan)} EUR · Onaylı değişiklik {e(x.onayliDegisiklik)} EUR{x.degisiklikNedeni ? ` (${x.degisiklikNedeni})` : ''} · Fiilî {e(x.fiili)} EUR · Açıklanamayan {e(x.aciklanamayan)} EUR · Süre sapması {x.sureSapmasiGun ?? '—'} gün (onaylı ek süre {x.onayliEkGun} gün){x.beklenmeyenKosul ? ` · Beklenmeyen koşul: ${x.beklenmeyenKosul}` : ''}</span></div>) : <div className="ozet bos">Dönemde kapanan dosya bulunmamaktadır.</div>}</details>;
}

/** YG-745: veri profilleme. */
export function VeriProfili() {
  const [t, setT] = useState('dosya'); const [v, setV] = useState<{ kayit: number; alanlar: { alan: string; doluluk: number | null; farkli: number; enKucuk: string | null; enBuyuk: string | null; bicimHata: number | null }[]; mukerrerAday: number | null; iliskiKopuklugu: { alan: string; hedef: string; kopuk: number }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>(`/veri-profili/${t}`).then(setV).catch(() => setV(null)); }, [t]);
  if (!v) return null;
  return <details><summary>Veri Profilleme</summary><label htmlFor="vp-t">Tablo</label><select id="vp-t" value={t} onChange={(x) => setT(x.target.value)}>{['dosya', 'yat', 'kurulus', 'taraf', 'musteri_faturasi'].map((x) => <option key={x}>{x}</option>)}</select>
    <div className="not">{v.kayit} kayıt{v.mukerrerAday !== null ? ` · Mükerrer aday grup: ${v.mukerrerAday}` : ''}{v.iliskiKopuklugu.map((k) => ` · ${k.alan} → ${k.hedef} kopuk: ${k.kopuk}`).join('')}</div>
    {v.alanlar.map((a) => <div className={a.bicimHata ? 'soru hata' : 'soru'} key={a.alan}><span>{a.alan} · Doluluk %{a.doluluk ?? '—'} · Farklı değer {a.farkli}{a.enKucuk ? ` · ${a.enKucuk.slice(0, 10)} – ${a.enBuyuk?.slice(0, 10)}` : ''}{a.bicimHata !== null ? ` · Beklenmeyen biçim ${a.bicimHata}` : ''}</span></div>)}</details>;
}
