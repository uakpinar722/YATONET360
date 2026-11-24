import { useState } from 'react';
import { istek } from './api';
import { eur, tarih } from './bicim';

type Ara = { taraf_no: string; unvan_ad_soyad: string; musteri_turu: string | null; telefon: string | null };
type K = Record<string, string | number | boolean | null | string[]>;
interface V { kimlik: K; acikAlacakEur: number; faturalar: K[]; sozlesmeler: K[]; yetkiBelgeleri: K[]; yetkililer: K[]; yatlar: K[]; dosyalar: K[] }
const SEKME = ['Kimlik', 'Açık Alacak', 'Sözleşmeler', 'Yetki Belgeleri', 'Yatlar', 'Dosyalar'] as const;

/** YG-106: Müşteri Ana Kaydı; arama, kimlik ve vergi bilgileri, açık alacak, sözleşmeler, yetki belgeleri, yatlar ve dosyalar. */
export function MusteriAnaKaydi() {
  const [q, setQ] = useState(''); const [l, setL] = useState<Ara[]>([]); const [v, setV] = useState<V | null>(null); const [s, setS] = useState<(typeof SEKME)[number]>('Kimlik'); const [h, setH] = useState('');
  const ac = (no: string) => { setH(''); void istek<V>(`/taraf/${encodeURIComponent(no)}/ana-kayit`).then((r) => { setV(r); setS('Kimlik'); }).catch((e) => setH(e.message)); };
  const satir = (et: string, d: unknown) => (d === null || d === undefined || d === '' ? null : <div key={et}><b>{et}:</b> {Array.isArray(d) ? d.join(', ') : String(d)}</div>);
  const k = v?.kimlik;
  return <details><summary>Müşteri Ana Kaydı</summary>{h && <div className="hata" role="alert">{h}</div>}
    <label htmlFor="ma-q">Ad, Unvan, Vergi No veya TCKN</label><input id="ma-q" value={q} onChange={(e) => setQ(e.target.value)} />
    <button className="btn2 kucuk" disabled={q.trim().length < 2} onClick={() => void istek<Ara[]>(`/taraf/ara?q=${encodeURIComponent(q.trim())}`).then(setL).catch((e) => setH(e.message))}>Ara</button>
    {l.map((x) => <div key={x.taraf_no}><button className="lnk" onClick={() => ac(x.taraf_no)}>{x.unvan_ad_soyad}</button> · {x.taraf_no}{x.musteri_turu ? ` · ${x.musteri_turu}` : ''}</div>)}
    {v && k && <div className="ozet">
      <b>{String(k.unvan_ad_soyad)}</b> · {String(k.taraf_no)}{k.pasif ? ' · Pasif' : ''}
      <div className="dugmeler">{SEKME.map((x) => <button key={x} className={x === s ? 'btn kucuk' : 'btn2 kucuk'} onClick={() => setS(x)}>{x}</button>)}</div>
      {s === 'Kimlik' && <>{[['Kişi Türü', k.kisi_turu], ['Müşteri Türü', k.musteri_turu], ['TCKN', k.tckn], ['Vergi Dairesi', k.vergi_dairesi], ['Vergi No', k.vergi_no], ['MERSİS No', k.mersis_no], ['KEP Adresi', k.kep_adresi], ['Adres', [k.adres, k.il, k.ulke].filter(Boolean).join(', ')], ['Telefon', k.telefon], ['E-posta', k.eposta], ['Kurumsal Onay E-postası', k.kurumsal_onay_epostasi], ['Tarama Sonucu', k.tarama_sonucu]].map(([a, b]) => satir(String(a), b))}</>}
      {s === 'Açık Alacak' && <><div><b>Açık Alacak (sistemce, KDV dahil):</b> {eur(v.acikAlacakEur)}</div>{v.faturalar.map((f, n) => <div key={n}>{String(f.fatura_no ?? f.proforma_no)} · {String(f.dosya_no)} · {eur(Number(f.toplam_eur) - Number(f.tahsil_edilen_eur))} · vade {tarih(f.vade as string | null)} · {String(f.durum)}</div>)}</>}
      {s === 'Sözleşmeler' && (v.sozlesmeler.length ? v.sozlesmeler.map((x, n) => <div key={n}>{String(x.sozlesme_no ?? 'Numarasız')} · {String(x.sozlesme_turu)} · {tarih(x.yururluk as string)}{x.bitis ? ` – ${tarih(x.bitis as string)}` : ''} · {String(x.durum)}</div>) : <div className="bos">Sözleşme kaydı yok.</div>)}
      {s === 'Yetki Belgeleri' && <>{v.yetkiBelgeleri.map((x, n) => <div key={n}>{String(x.dosya_no)} · {String(x.yetki_dayanagi_turu)} · {String(x.belge_duzenleyen)} · {tarih(x.belge_tarihi as string)}{x.gecerlilik_bitisi ? ` · bitiş ${tarih(x.gecerlilik_bitisi as string)}` : ''}</div>)}{v.yetkililer.map((x, n) => <div key={`y${n}`}>{String(x.ad_soyad)} · {String(x.rol)} · {String(x.belge_durumu)}{x.bitis_tarihi ? ` · bitiş ${tarih(x.bitis_tarihi as string)}` : ''}</div>)}{!v.yetkiBelgeleri.length && !v.yetkililer.length && <div className="bos">Yetki belgesi yok.</div>}</>}
      {s === 'Yatlar' && (v.yatlar.length ? v.yatlar.map((x, n) => <div key={n}>{String(x.yat_adi)}{x.tur ? ` · ${String(x.tur)}` : ''}{x.bayrak ? ` · ${String(x.bayrak)}` : ''}{x.tam_boy_m ? ` · ${String(x.tam_boy_m).replace('.', ',')} m` : ''} · {String(x.acik_dosya)} açık dosya</div>) : <div className="bos">Kayıtlı yat yok.</div>)}
      {s === 'Dosyalar' && (v.dosyalar.length ? v.dosyalar.map((x, n) => <div key={n}>{String(x.dosya_no)} · {String(x.statu)}</div>) : <div className="bos">Dosya yok.</div>)}
    </div>}
  </details>;
}
