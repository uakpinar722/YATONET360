import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

interface Secenekler { kullanicilar: { kimlik: string; ad_soyad: string }[]; roller: { kimlik: string; rol_adi: string; rol_sahibi_birim: string }[] }
interface Talep { kimlik: string; talep_asamasi: string; sure_sonu: string; kullanici: string; rol: string }
interface Uygulanacak { kimlik: string; sure_sonu: string; kapsam: string; is_gerekcesi: string; kullanici: string; rol: string; onaylayan: string; kendi: boolean }

const gun = (s: string) => s.split('-').reverse().join('.');
const ASAMA: Record<string, string> = { 'İş Onayı': 'Birim Onayında', 'Teknik Atama': 'Sistem Yöneticisinde', Bildirim: 'Tamamlandı', Reddedildi: 'Reddedildi', 'İade Edildi': 'İade Edildi' };

/** YG-1040: erişim yalnız tekil kayıtla açılır; rol açılır listeden seçilir (YG-1008). */
export function ErisimTalebi() {
  const [s, setS] = useState<Secenekler | null>(null);
  const [l, setL] = useState<Talep[]>([]);
  const [f, setF] = useState({ kullanici: '', rol: '', gerekce: '', kapsam: '', sureSonu: '' });
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yukle = () => istek<Talep[]>('/erisim/taleplerim').then(setL);
  useEffect(() => { istek<Secenekler>('/erisim/secenekler').then(setS).catch((e) => setHata(e.message)); void yukle(); }, []);
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata(''); setNot('');
    try {
      const r = await istek<{ kimlik: string }>('/erisim/talep', f);
      setNot(`${r.kimlik} numaralı talebiniz birim onayına gönderilmiştir.`);
      setF({ kullanici: '', rol: '', gerekce: '', kapsam: '', sureSonu: '' }); void yukle();
    } catch (x) { setHata((x as Error).message); }
  };
  const d = (a: keyof typeof f, v: string) => setF({ ...f, [a]: v });
  return (
    <>
      <h1>Erişim Talebi</h1>
      {!s && hata && <div className="hata" role="alert">{hata}</div>}
      {s && (
        <form className="ozet" onSubmit={(e) => void gonder(e)}>
          <label htmlFor="et-k">Erişim Verilecek Kullanıcı</label>
          <select id="et-k" value={f.kullanici} onChange={(e) => d('kullanici', e.target.value)}><option value="">Seçiniz</option>{s.kullanicilar.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select>
          <label htmlFor="et-r">Talep Edilen Rol</label>
          <select id="et-r" value={f.rol} onChange={(e) => d('rol', e.target.value)}><option value="">Seçiniz</option>{s.roller.map((r) => <option key={r.kimlik} value={r.kimlik}>{r.rol_adi}</option>)}</select>
          <label htmlFor="et-g">Görev ve İş Gerekçesi</label>
          <textarea id="et-g" rows={2} value={f.gerekce} onChange={(e) => d('gerekce', e.target.value)} />
          <label htmlFor="et-c">Kapsam</label>
          <textarea id="et-c" rows={2} value={f.kapsam} onChange={(e) => d('kapsam', e.target.value)} />
          <label htmlFor="et-s">Talep Edilen Süre Sonu</label>
          <input id="et-s" type="date" value={f.sureSonu} onChange={(e) => d('sureSonu', e.target.value)} />
          {hata && <div className="hata" role="alert">{hata}</div>}
          {not && <div className="basari">{not}</div>}
          <button className="btn" disabled={!f.kullanici || !f.rol || !f.gerekce.trim() || !f.kapsam.trim() || !f.sureSonu}>Talebi Gönder</button>
        </form>
      )}
      <div className="bolum">Taleplerim</div>
      {l.length === 0 ? <div className="ozet bos">Erişim talebiniz bulunmamaktadır.</div> : (
        <div className="tablo"><table className="kartli">
          <thead><tr><th>Talep No</th><th>Kullanıcı</th><th>Rol</th><th>Bitiş</th><th>Durum</th></tr></thead>
          <tbody>{l.map((t) => <tr key={t.kimlik}><td data-ad="Talep No">{t.kimlik}</td><td data-ad="Kullanıcı">{t.kullanici}</td><td data-ad="Rol">{t.rol}</td><td data-ad="Bitiş">{gun(t.sure_sonu)}</td><td data-ad="Durum">{ASAMA[t.talep_asamasi] ?? t.talep_asamasi}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

/** A33-2: onaylı talepler; kendi hesabına yetki engellidir. */
export function ErisimVeRol() {
  const [l, setL] = useState<Uygulanacak[] | null>(null);
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yukle = () => istek<Uygulanacak[]>('/erisim/uygulanacak').then(setL).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, []);
  const uygula = async (id: string) => {
    setHata(''); setNot('');
    try {
      const r = await istek<{ izinDogrulandi: boolean }>(`/erisim/${id}/uygula`, {});
      setNot(r.izinDogrulandi ? `${id} uygulanmış, gerçek yetki onay kaydıyla karşılaştırılmıştır; kullanıcıya bildirim gönderilmiştir.` : `${id} uygulandı ancak yetki doğrulanamadı; kaydı kontrol ediniz.`);
      void yukle();
    } catch (x) { setHata((x as Error).message); }
  };
  return (
    <>
      <h1>Erişim ve Rol</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {not && <div className="basari">{not}</div>}
      <div className="bolum">Uygulanacak Onaylı Talepler</div>
      {l?.length === 0 && <div className="ozet bos">Uygulanacak onaylı talep bulunmamaktadır.</div>}
      {l?.map((t) => (
        <div key={t.kimlik} className="ozet kart-sol">
          <div className="ust2"><b>{t.kimlik}</b></div>
          <div className="not">{t.kullanici} · {t.rol} · Bitiş: {gun(t.sure_sonu)}</div>
          <div className="not">Kapsam: {t.kapsam}</div>
          <div className="not">Gerekçe: {t.is_gerekcesi}</div>
          <div className="not">Onaylayan: {t.onaylayan}</div>
          {t.kendi && <div className="uyari">Kendi hesabınıza yetki tanımlayamazsınız.</div>}
          <div className="dugmeler"><button className="btn" disabled={t.kendi} onClick={() => void uygula(t.kimlik)}>Uygula ve Kullanıcıya Bildir</button></div>
        </div>
      ))}
    </>
  );
}
