import { useEffect, useState } from 'react';
import { istek } from './api';

type Tanim = { is_anlami: string; giris_kosulu: string; cikis_kosulu: string; yetkili_rol: string; izinli_gecisler: string[]; zorunlu_aciklama: boolean; sure_durur: boolean; otomatik_bildirim: string | null; musteri_adi: string | null };
type V = { turler: { kayit_turu: string; alan: string; durumlar: string[]; tanimlar: { durum: string; tanim: Tanim | null }[] }[]; yetkili: boolean; ozet: { tur: number; durum: number; tanimli: number }; cakisma: { durum: string; anlamlar: string[] }[] };
/** YG-1365: birleşik durum sözlüğü. */
export function DurumSozlugu() {
  const [v, setV] = useState<V | null>(null); const [q, setQ] = useState(''); const [f, setF] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/durum-sozlugu').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const k = q.trim().toLocaleLowerCase('tr');
  const liste = k.length < 2 ? [] : v.turler.filter((t) => t.kayit_turu.includes(k) || t.durumlar.some((d) => d.toLocaleLowerCase('tr').includes(k)));
  const al = (a: string, et: string) => <span key={a}><label htmlFor={`ds-${a}`}>{et}</label><input id={`ds-${a}`} value={f[a] ?? ''} onChange={(e) => setF({ ...f, [a]: e.target.value })} /></span>;
  const sec = (t: string, d: string, x: Tanim | null) => setF({ tur: t, durum: d, anlam: x?.is_anlami ?? '', giris: x?.giris_kosulu ?? '', cikis: x?.cikis_kosulu ?? '', rol: x?.yetkili_rol ?? '', gecis: (x?.izinli_gecisler ?? []).join(', '), aciklama: x?.zorunlu_aciklama ? '1' : '', sure: x?.sure_durur ? '1' : '', bildirim: x?.otomatik_bildirim ?? '', musteri: x?.musteri_adi ?? '' });
  return <details><summary>Durum Sözlüğü · {v.ozet.tanimli}/{v.ozet.durum} durum tanımlı</summary>{m && <div className="not" role="status">{m}</div>}
    {v.cakisma.map((c) => <div className="soru hata" key={c.durum}><span>"{c.durum}" farklı anlamlarla tanımlı: {c.anlamlar.join(' | ')}</span></div>)}
    <label htmlFor="ds-ara">Kayıt türü veya durum ara</label><input id="ds-ara" value={q} onChange={(e) => setQ(e.target.value)} />
    {liste.slice(0, 30).map((t) => <div key={`${t.kayit_turu}.${t.alan}`}><div className="bolum">{t.kayit_turu} · {t.alan}</div>{t.tanimlar.map(({ durum, tanim }) => <div className={tanim ? 'soru' : 'soru hata'} key={durum}><span>{durum}{tanim ? ` · ${tanim.is_anlami} · Yetkili: ${tanim.yetkili_rol}${tanim.izinli_gecisler.length ? ` · Geçiş: ${tanim.izinli_gecisler.join(', ')}` : ''}${tanim.sure_durur ? ' · Süre durur' : ''}${tanim.zorunlu_aciklama ? ' · Açıklama zorunlu' : ''}${tanim.musteri_adi ? ` · Müşteriye: ${tanim.musteri_adi}` : ''}` : ' · Tanımsız'}</span>
      {v.yetkili && <button className="btn2 kucuk" onClick={() => sec(t.kayit_turu, durum, tanim)}>Düzenle</button>}</div>)}</div>)}
    {v.yetkili && f.tur && <div className="tam"><div className="bolum">{f.tur} · {f.durum}</div>{al('anlam', 'İş Anlamı')}{al('giris', 'Giriş Koşulu')}{al('cikis', 'Çıkış Koşulu')}{al('rol', 'Yetkili Rol')}{al('gecis', 'İzinli Geçişler (virgülle)')}{al('bildirim', 'Otomatik Bildirim')}{al('musteri', 'Müşteriye Görünen Ad')}
      <label className="kutu"><input type="checkbox" checked={f.aciklama === '1'} onChange={(e) => setF({ ...f, aciklama: e.target.checked ? '1' : '' })} /><span>Açıklama zorunlu</span></label>
      <label className="kutu"><input type="checkbox" checked={f.sure === '1'} onChange={(e) => setF({ ...f, sure: e.target.checked ? '1' : '' })} /><span>Bu durumda süre durur</span></label>
      <button className="btn2 kucuk" onClick={() => void istek('/durum-sozlugu', { kayitTuru: f.tur, durum: f.durum, isAnlami: f.anlam, girisKosulu: f.giris, cikisKosulu: f.cikis, yetkiliRol: f.rol, izinliGecisler: (f.gecis ?? '').split(',').map((x) => x.trim()).filter(Boolean), zorunluAciklama: f.aciklama === '1', sureDurur: f.sure === '1', otomatikBildirim: f.bildirim, musteriAdi: f.musteri }).then(() => { setM('Kaydedildi.'); setF({}); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div>}</details>;
}
