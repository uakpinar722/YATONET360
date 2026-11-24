import { useState } from 'react';
import { istek } from './api';
import { eur, tarih, tarihSaat } from './bicim';

type N = string | number | boolean | null;
interface V { formKodu: string; dosyaNo: string; proforma: Record<string, N>; muhatap: Record<string, N> | null; teknikKabulZamani: string | null; fatura: Record<string, N>; vade: string | null; tahsilEdilenEur: string; kalanEur: number; gecikmeGun: number; tahsilatlar: { tarih: string; tutar_eur: string; kanal: string; referans: string | null }[]; alacakTakip: { basamak: string; sorumlu_rol: string; zaman: string }[] }
const S = (x: N | undefined) => (x === null || x === undefined || x === '' ? '---' : String(x));

/** YG-640: FR-TIC-010 Müşteri Faturası, Tahsilat ve Alacak Takip Formu; proforma formun içindedir. */
export function FaturaTakipFormu({ id }: { id: string }) {
  const [v, setV] = useState<V | null>(null); const [h, setH] = useState('');
  if (!v) return <button className="btn2 kucuk" onClick={() => void istek<V>(`/fatura/${id}/takip-formu`).then(setV).catch((e) => setH(e.message))}>Takip Formu{h ? ` (${h})` : ''}</button>;
  const p = v.proforma; const f = v.fatura; const m = v.muhatap;
  return <div className="ozet"><b>{v.formKodu} · Müşteri Faturası, Tahsilat ve Alacak Takip Formu · {v.dosyaNo}</b>
    <div className="bolum">Proforma</div>
    <div>{S(p.proformaNo)} · {tarihSaat(p.tarih as string)} · Hazırlayan: {S(p.hazirlayan)} · Teklif: {S(p.teklif)}</div>
    <div>KDV Hariç: {eur(p.kdvHaricEur as string)} · KDV ({S(p.kdvDurumu)}{p.kdvOrani ? ` %${S(p.kdvOrani)}` : ''}): {eur(p.kdvEur as string)}{p.tevkifatEur ? ` · Tevkifat: ${eur(p.tevkifatEur as string)}` : ''} · Toplam: {eur(p.toplamEur as string)}</div>
    <div className="bolum">Muhatap</div>
    <div>{S(p.muhatapTuru)}{m ? ` · ${S(m.unvan)}${m.vergi_no ? ` · ${S(m.vergi_dairesi)} ${S(m.vergi_no)}` : ''}${m.hasar_no ? ` · Hasar Dosya No: ${S(m.hasar_no)}` : ''}${m.adres ? ` · ${S(m.adres)}` : ''}` : ''}</div>
    <div>Teknik Kabul: {v.teknikKabulZamani ? tarihSaat(v.teknikKabulZamani) : '---'}</div>
    <div className="bolum">Fatura</div>
    <div>{S(f.durum)} · No: {S(f.faturaNo)} · Tarih: {tarih(f.faturaTarihi as string | null)} · Kur: {S(f.kur)} ({tarih(f.kurTarihi as string | null)}{f.kurKaynagi ? `, ${S(f.kurKaynagi)}` : ''}) · Toplam TL: {S(f.toplamTl)} · PDF: {f.pdf ? 'Var' : 'Yok'}</div>
    <div>Muhasebeye İletim: {f.muhasebeyeIletim ? tarihSaat(f.muhasebeyeIletim as string) : '---'}{f.gecIslendi ? ' · 8 saati aşarak işlendi' : ''}</div>
    <div className="bolum">Tahsilat ve Alacak</div>
    <div>Vade: {tarih(v.vade)} · Tahsil Edilen: {eur(v.tahsilEdilenEur)} · Kalan: {eur(v.kalanEur)}{v.gecikmeGun ? ` · ${v.gecikmeGun} gün gecikmede` : ''}</div>
    {v.tahsilatlar.map((x, n) => <div key={n}>{tarih(x.tarih)} · {eur(x.tutar_eur)} · {x.kanal}{x.referans ? ` · ${x.referans}` : ''}</div>)}
    {v.alacakTakip.map((x, n) => <div key={`a${n}`}>{tarihSaat(x.zaman)} · {x.basamak} · {x.sorumlu_rol}</div>)}
    <button className="btn2 kucuk" onClick={() => setV(null)}>Kapat</button>
  </div>;
}
