import { useEffect, useState } from 'react';
import { istek } from './api';

type H = { kimlik: string; ad_soyad: string; e_posta: string; hesap_durumu: string; sigortaci_adi: string; tsb_kodu: string | null };

/** YG-453: sigorta şirketinin yazılı yetkilendirdiği kişiye portal hesabı açılır; ayrılış veya görev değişikliği bildirilince hesap kapanır. */
export function SigortaHesaplari() {
  const [l, setL] = useState<H[]>([]); const [s, setS] = useState<{ tsb_kodu: string; tam_unvan: string; durum: string }[]>([]); const [m, setM] = useState('');
  const [f, setF] = useState({ tsbKodu: '', ad: '', eposta: '', telefon: '', dayanak: '' }); const [k, setK] = useState({ id: '', tur: 'Ayrılış', kanal: 'E-posta', zaman: '' });
  const yk = () => istek<H[]>('/sigorta-kullanicilar').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); void istek<typeof s>('/sigorta-sirketleri').then((x) => setS(x.filter((y) => y.durum === 'Aktif'))).catch(() => setS([])); }, []);
  const ac = () => void istek('/sigorta-kullanici', { ...f, telefon: f.telefon || undefined }).then(() => { setM('Hesap açıldı; davet e-postası gönderildi.'); setF({ tsbKodu: '', ad: '', eposta: '', telefon: '', dayanak: '' }); return yk(); }).catch((e) => setM(e.message));
  const kapat = () => void istek(`/dis-kullanici/${k.id}/ayrilis-bildirimi`, { tur: k.tur, kanal: k.kanal, bildirimZamani: new Date(k.zaman).toISOString() }).then(() => { setM('Hesap kapatıldı.'); setK({ id: '', tur: 'Ayrılış', kanal: 'E-posta', zaman: '' }); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Sigorta Portalı Hesapları</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 ? <div className="not">Kayıt bulunmamaktadır.</div> : l.map((x) => <div key={x.kimlik}>{x.sigortaci_adi}{x.tsb_kodu ? '' : ' (sicile bağlı değil)'} · {x.ad_soyad} · {x.e_posta} · {x.hesap_durumu}{!x.tsb_kodu && f.tsbKodu && <button className="btn2 kucuk" onClick={() => void istek(`/sigorta-kullanici/${x.kimlik}/bagla`, { tsbKodu: f.tsbKodu }).then(() => { setM('Kullanıcı seçili şirket kaydına bağlandı.'); return yk(); }).catch((e) => setM(e.message))}>Seçili Şirkete Bağla</button>}{x.hesap_durumu !== 'Kapalı' && <button className="btn2 kucuk" onClick={() => setK({ ...k, id: x.kimlik })}>Kapat</button>}</div>)}</div>
    {k.id && <div className="ozet"><div>Hesap kapatma: {l.find((x) => x.kimlik === k.id)?.ad_soyad}</div>
      <label htmlFor="sh-kt">Bildirim Türü</label><select id="sh-kt" value={k.tur} onChange={(e) => setK({ ...k, tur: e.target.value })}>{['Ayrılış', 'Görev Değişikliği'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="sh-kk">Bildirim Kanalı</label><select id="sh-kk" value={k.kanal} onChange={(e) => setK({ ...k, kanal: e.target.value })}>{['E-posta', 'Telefon', 'Yazı'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="sh-kz">Bildirim Zamanı</label><input id="sh-kz" type="datetime-local" value={k.zaman} onChange={(e) => setK({ ...k, zaman: e.target.value })} />
      <button className="btn hayir" disabled={!k.zaman} onClick={kapat}>Hesabı Kapat</button></div>}
    <label htmlFor="sh-s">Hesap Açılacak Sigorta Şirketi</label><select id="sh-s" value={f.tsbKodu} onChange={(e) => setF({ ...f, tsbKodu: e.target.value })}><option value="">Seçiniz</option>{s.map((x) => <option key={x.tsb_kodu} value={x.tsb_kodu}>{x.tam_unvan}</option>)}</select>
    <label htmlFor="sh-a">Hesap Sahibi Ad Soyad</label><input id="sh-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
    <label htmlFor="sh-e">Hesap Sahibi E-posta</label><input id="sh-e" type="email" value={f.eposta} onChange={(e) => setF({ ...f, eposta: e.target.value })} />
    <label htmlFor="sh-t">Hesap Sahibi Telefon</label><input id="sh-t" value={f.telefon} onChange={(e) => setF({ ...f, telefon: e.target.value })} />
    <label htmlFor="sh-d">Yetkilendirme Yazısı (Tarih / Sayı)</label><input id="sh-d" value={f.dayanak} onChange={(e) => setF({ ...f, dayanak: e.target.value })} />
    <button className="btn2" disabled={!f.tsbKodu || !f.ad.trim() || !f.eposta.trim() || !f.dayanak.trim()} onClick={ac}>Hesap Aç</button></>;
}
