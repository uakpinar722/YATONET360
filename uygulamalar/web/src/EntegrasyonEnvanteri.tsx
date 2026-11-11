import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { kaynakAlan: string; hedefAlan: string; donusum: string; eslestirme: string; varsayilan: string; guncellenme: string };
type B = { kimlik: string; ad: string; gonderen_sistem: string; alan_sistem: string; yon: string | null; veri_akisi: string | null; kayit_sahibi: string; teknik_sahip: string | null; bilgi_sinifi: string; hizmet_hesabi: string | null; uc_nokta: string | null; surum: string | null; siklik: string; hizmet_beklentisi: string; destek_yolu: string | null; paylasim_amaci: string; durum: string; veri_sozlesmesi: S[]; son_dogrulama: string | null; son_veri: string | null };
type A = { kimlik: string; ad: string; donem: string; kaynak: string; gercek_sayi: number; sonuc: string; kabul_sayisi: number; red_sayisi: number; red_raporu: { sira: number; neden: string }[]; karantina_nedeni: string | null; zaman: string };
const z = (s: string | null) => (s ? new Date(s).toLocaleString('tr-TR') : 'Veri gelmedi');
/** YG-1297, 1298, 1300, 1315, 1317: entegrasyon envanteri, veri sözleşmesi ve toplu aktarım. */
export function EntegrasyonEnvanteri() {
  const [v, setV] = useState<{ duzenler: boolean; yukler: boolean; baglantilar: B[]; aktarimlar: A[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/entegrasyon-envanteri').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); setG({}); return yk(); }).catch((e) => setM(e.message));
  const al = (k: string, et: string) => <span key={k}><label htmlFor={`ee-${k}`}>{et}</label><input id={`ee-${k}`} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></span>;
  return <details><summary>Entegrasyon Envanteri · {v.baglantilar.length} bağlantı</summary>{m && <div className="not" role="status">{m}</div>}
    {v.baglantilar.map((x) => <div className={x.durum === 'İncelemede' || x.durum === 'Askıda' ? 'soru hata' : 'soru'} key={x.kimlik}><span><b>{x.ad}</b> · {x.gonderen_sistem} → {x.alan_sistem}{x.yon ? ` (${x.yon})` : ''} · {x.durum} · {x.bilgi_sinifi}
      <br />Amaç: {x.paylasim_amaci}{x.veri_akisi ? ` · Akış: ${x.veri_akisi}` : ''}
      <br />Süreç sahibi: {x.kayit_sahibi}{x.teknik_sahip ? ` · Teknik sahip: ${x.teknik_sahip}` : ''} · Hizmet hesabı: {x.hizmet_hesabi ?? '—'} · Uç nokta: {x.uc_nokta ?? '—'} · Sürüm: {x.surum ?? '—'} · Sıklık: {x.siklik} · Hizmet seviyesi: {x.hizmet_beklentisi} · Destek: {x.destek_yolu ?? '—'}
      <br />Son veri: {z(x.son_veri)} · Son doğrulama: {x.son_dogrulama ? x.son_dogrulama.split('-').reverse().join('.') : 'Yapılmadı'}
      {x.veri_sozlesmesi.map((s, i) => <span key={i}><br />{s.kaynakAlan} → {s.hedefAlan} · Dönüşüm: {s.donusum} · Eşleştirme: {s.eslestirme} · Varsayılan: {s.varsayilan} · Güncellenme: {s.guncellenme}</span>)}</span>
      <div className="tam">{v.duzenler && <><button className="btn2 kucuk" onClick={() => setG({ ac: x.kimlik, teknikSahip: x.teknik_sahip ?? '', hizmetHesabi: x.hizmet_hesabi ?? '', ucNokta: x.uc_nokta ?? '', surum: x.surum ?? '', destekYolu: x.destek_yolu ?? '' })}>Düzenle</button>
        {al(`dg${x.kimlik}`, 'Doğrulama Gerekçesi')}<button className="btn2 kucuk" onClick={() => is(istek(`/entegrasyon-envanteri/${x.kimlik}/dogrula`, { gerekce: g[`dg${x.kimlik}`] }), 'Sahip ve amaç doğrulandı.')}>Sahip ve Amacı Doğrula</button></>}
        {g.ac === x.kimlik && <>{al('teknikSahip', 'Teknik Sahip')}{al('hizmetHesabi', 'Hizmet Hesabı')}{al('ucNokta', 'Uç Nokta')}{al('surum', 'Sürüm / Şema')}{al('destekYolu', 'Destek Yolu')}
          <div className="not">Veri sözleşmesi satırı (isteğe bağlı)</div>{al('ka', 'Kaynak Alan')}{al('ha', 'Hedef Alan')}{al('do', 'Dönüşüm')}{al('es', 'Eşleştirme')}{al('va', 'Varsayılan Değer')}{al('gu', 'Güncellenme Zamanı')}
          <button className="btn2 kucuk" onClick={() => is(istek(`/entegrasyon-envanteri/${x.kimlik}`, { teknikSahip: g.teknikSahip, hizmetHesabi: g.hizmetHesabi, ucNokta: g.ucNokta, surum: g.surum, destekYolu: g.destekYolu, ...(g.ka ? { veriSozlesmesi: [...x.veri_sozlesmesi, { kaynakAlan: g.ka, hedefAlan: g.ha, donusum: g.do, eslestirme: g.es, varsayilan: g.va, guncellenme: g.gu }] } : {}) }), 'Envanter güncellendi.')}>Kaydet</button></>}</div></div>)}
    <div className="bolum">Toplu Dosya Aktarımları</div>{v.aktarimlar.length ? v.aktarimlar.map((x) => <div className={x.sonuc === 'Karantina' ? 'soru hata' : 'soru'} key={x.kimlik}><span>{z(x.zaman)} · {x.ad} · {x.donem} · {x.kaynak} · {x.gercek_sayi} kayıt · {x.sonuc}{x.karantina_nedeni ? ` · ${x.karantina_nedeni}` : ''}{x.sonuc !== 'Karantina' ? ` · Kabul ${x.kabul_sayisi} · Red ${x.red_sayisi}` : ''}{x.red_raporu.length ? ` · Reddedilen satırlar: ${x.red_raporu.map((r) => `${r.sira} (${r.neden})`).join(', ')}` : ''}</span></div>) : <div className="ozet bos">Toplu aktarım bulunmamaktadır.</div>}</details>;
}
