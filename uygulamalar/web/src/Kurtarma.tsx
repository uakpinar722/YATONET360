import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

interface Hesap { kimlik: string; ad_soyad: string; kullanici_grubu: string; hesap_durumu: string }
interface Kayit { kimlik: string; durum: string; kullanici: string; makam: string | null }

/** A32-3 Hesap Kurtarma: kimlik teyidi yapılır, onay makama gider; rol veya yetki burada tanımlanmaz. */
export function HesapKurtarma() {
  const [ara, setAra] = useState(''); const [h, setH] = useState<Hesap | null>(null);
  const [teyit, setTeyit] = useState(''); const [neden, setNeden] = useState('');
  const [l, setL] = useState<Kayit[]>([]); const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yukle = () => istek<Kayit[]>('/hesap-kurtarma').then(setL).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, []);
  const bul = async (e: FormEvent) => {
    e.preventDefault(); setHata(''); setNot(''); setH(null);
    try { setH(await istek<Hesap>('/hesap-kurtarma/bul', { kimlik: ara })); } catch (x) { setHata((x as Error).message); }
  };
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata('');
    try {
      const r = await istek<{ kimlik: string; dis: boolean }>('/hesap-kurtarma', { kullanici: h!.kimlik, kimlikTeyidi: teyit, neden });
      setNot(`${r.kimlik} ${r.dis ? 'teyit için' : 'birim onayı için'} gönderilmiştir.`);
      setH(null); setAra(''); setTeyit(''); setNeden(''); void yukle();
    } catch (x) { setHata((x as Error).message); }
  };
  return (
    <>
      <h1>Hesap Kurtarma</h1>
      <form className="ozet" onSubmit={(e) => void bul(e)}>
        <label htmlFor="hk-a">Kullanıcının E-Postası veya Cep Telefonu</label>
        <input id="hk-a" value={ara} onChange={(e) => setAra(e.target.value)} />
        <div className="dugmeler"><button className="btn2" disabled={!ara.trim()}>Hesabı Bul</button></div>
      </form>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {not && <div className="basari">{not}</div>}
      {h && (
        <form className="ozet kart-sol" onSubmit={(e) => void gonder(e)}>
          <div className="ust2"><b>{h.ad_soyad}</b><em className="rozet gri">{h.hesap_durumu}</em></div>
          <div className="not">{h.kullanici_grubu}</div>
          <label htmlFor="hk-t">Kimlik Teyidi</label>
          <textarea id="hk-t" rows={2} value={teyit} onChange={(e) => setTeyit(e.target.value)} placeholder="Kimliği nasıl doğruladınız?" />
          <label htmlFor="hk-n">Neden</label>
          <textarea id="hk-n" rows={2} value={neden} onChange={(e) => setNeden(e.target.value)} placeholder="Ör. Telefon kayboldu" />
          <div className="not">Onaylanınca kullanıcının doğrulama uygulaması sıfırlanır ve açık oturumları kapanır.</div>
          <div className="dugmeler"><button className="btn" disabled={!teyit.trim() || !neden.trim()}>Onaya Gönder</button></div>
        </form>
      )}
      <div className="bolum">Açtığım Kayıtlar</div>
      {l.length === 0 ? <div className="ozet bos">Kayıt bulunmamaktadır.</div> : (
        <div className="tablo"><table className="kartli">
          <thead><tr><th>Talep No</th><th>Kullanıcı</th><th>Durum</th></tr></thead>
          <tbody>{l.map((t) => <tr key={t.kimlik}><td data-ad="Talep No">{t.kimlik}</td><td data-ad="Kullanıcı">{t.kullanici}</td><td data-ad="Durum">{t.durum === 'Teyit Bekliyor' && t.makam ? `${t.makam} Kontrolünde` : t.durum}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}
