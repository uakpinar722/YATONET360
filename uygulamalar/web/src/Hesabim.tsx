import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

/** Parola yenileme bağlantısından açılan ekran (YG-1156). Metinler G-2 parola adımıyla aynıdır. */
export function ParolaYenile({ belirtec, bitti }: { belirtec: string; bitti: () => void }) {
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [hata, setHata] = useState(''); const [tamam, setTamam] = useState(false); const [mesgul, setMesgul] = useState(false);
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata(''); setMesgul(true);
    try { await istek('/kimlik/parola-yenile', { belirtec, parola: p1 }); history.replaceState(null, '', location.pathname); setTamam(true); }
    catch (x) { setHata((x as Error).message); } finally { setMesgul(false); }
  };
  return (
    <div className="ilk"><div className="ilk-kart">
      <div className="ilk-bas"><img src="/lgm_yatay_tr.png" alt="LİMİT GLOBAL MARINE" /></div>
      <div className="ilk-ic">
        {tamam ? (<>
          <h2>Parolanız Yenilenmiştir</h2>
          <div className="basari">✔ Yeni parolanızla giriş yapabilirsiniz. Girişte doğrulama kodu yine istenecektir.</div>
          <button className="btn" onClick={bitti}>Giriş Ekranına Dön</button>
        </>) : (
          <form onSubmit={(e) => void gonder(e)}>
            <h2>Yeni Parola Belirleyiniz</h2>
            <div className="not">Parolanız en az 12 karakterden oluşmalıdır. Güvenliğiniz için, sızdırıldığı bilinen parolalar sistem tarafından kabul edilmemektedir.</div>
            <label htmlFor="y1">Parola</label>
            <input id="y1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
            <div className="not">{[...p1].length >= 12 ? '✔' : '○'} En Az 12 Karakter</div>
            <label htmlFor="y2">Parolayı Tekrar Giriniz</label>
            <input id="y2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
            {p2 && <div className="not">{p1 === p2 ? '✔ Parolalar eşleşmektedir.' : '✖ Parolalar eşleşmemektedir.'}</div>}
            {hata && <div className="hata" role="alert">{hata}</div>}
            <button className="btn" disabled={mesgul || [...p1].length < 12 || p1 !== p2}>Parolamı Yenile</button>
            <button type="button" className="lnk" onClick={bitti}>← Giriş Ekranı</button>
          </form>
        )}
      </div>
      <div className="ilk-dip"><span className="ayrac" aria-hidden="true" /><img src="/yatonet.png" alt="YATONET 360" /></div>
    </div></div>
  );
}

interface Izin { tur: string; amac: string | null; kanal: string | null; verildi: boolean }
interface Profil { adSoyad: string; ePosta: string | null; telefon: string | null; dil: 'tr' | 'en'; kanal: string; dis: boolean; izinler: Izin[] }

const izinAdi = (z: Izin) => z.amac ?? z.kanal ?? z.tur.replace('Özel gün – ', '');

/** A1-5 ve YG-1627: kişisel bilgiler, dil, parola, izinler. */
export function Profilim() {
  const [p, setP] = useState<Profil | null>(null);
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const [ep, setEp] = useState({ yeni: '', parola: '', kod: '' }); const [kapat, setKapat] = useState(false); const [eski, setEski] = useState(''); const [yeni, setYeni] = useState('');
  const yukle = () => istek<Profil>('/profil').then(setP).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, []);
  const yap = async (f: () => Promise<unknown>, n: string) => {
    setHata(''); setNot('');
    try { await f(); setNot(n); await yukle(); } catch (e) { setHata((e as Error).message); }
  };
  if (!p) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  const amac = p.izinler.filter((z) => z.amac), kanal = p.izinler.filter((z) => z.kanal), ozel = p.izinler.filter((z) => !z.amac && !z.kanal);
  const kutu = (z: Izin) => (
    <label key={izinAdi(z)} className="kutu">
      <input type="checkbox" checked={z.verildi} onChange={(e) => {
        const ver = e.target.checked;
        // İşaret anında değişir; sunucu reddederse yeniden yükleme eski haline döndürür.
        setP((o) => o && { ...o, izinler: o.izinler.map((x) => (x === z ? { ...x, verildi: ver } : x)) });
        void yap(() => istek('/profil/izin', { tur: z.tur, amac: z.amac, kanal: z.kanal, ver }), 'İzin tercihiniz kaydedilmiştir.').then(() => { void yukle(); });
      }} />
      <span>{izinAdi(z)}</span>
    </label>
  );
  return (
    <>
      <h1>Profil</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {not && <div className="basari">{not}</div>}
      <div className="ozet"><dl>
        <dt>Ad Soyad</dt><dd>{p.adSoyad}</dd>
        <dt>E-Posta</dt><dd>{p.ePosta ?? '—'}</dd>
        <dt>Cep Telefonu</dt><dd>{p.telefon ?? '—'}</dd>
      </dl></div>

      <h2 className="ara">Dil</h2>
      <div className="satir2">
        {(['tr', 'en'] as const).map((d) => (
          <button key={d} type="button" className={`secenek orta${p.dil === d ? ' secili-kart' : ''}`} onClick={() => void yap(() => istek('/profil/dil', { dil: d }), 'Dil tercihiniz kaydedilmiştir.')}><b>{d === 'tr' ? 'Türkçe' : 'English'}</b></button>
        ))}
      </div>

      {p.dis && (<>
        <h2 className="ara">Bildirim Kanalı</h2>
        <div className="not">İş bildirimleriniz seçtiğiniz kanaldan iletilir; bu bildirimler kapatılamaz. Onay kodları her zaman SMS ile gönderilir.</div>
        <div className="satir2">
          {['E-posta', 'SMS', 'WhatsApp'].map((k) => (
            <button key={k} type="button" className={`secenek orta${p.kanal === k ? ' secili-kart' : ''}`} onClick={() => void yap(() => istek('/profil/kanal', { kanal: k }), 'Kanal tercihiniz kaydedilmiştir.')}><b>{k}</b></button>
          ))}
        </div>
      </>)}

      {p.izinler.length > 0 && (<>
        <h2 className="ara">İzinlerim</h2>
        <div className="not">Bu izinler isteğe bağlıdır; dilediğiniz an tek adımda geri alabilirsiniz.</div>
        {ozel.map(kutu)}
        {amac.length > 0 && <label>İşleme Amaçları</label>}{amac.map(kutu)}
        {kanal.length > 0 && <label>Ticari İleti Kanalları</label>}
        {kanal.length > 0 && <div className="kanallar">{kanal.map(kutu)}</div>}
      </>)}

      {p.dis && <>
        <h2 className="ara">Hesabımı Kapat</h2>
        <div className="not">Hesabınız kapatılır; dosya kayıtları yasal saklama süresince korunur.</div>
        <label className="kutu"><input type="checkbox" checked={kapat} onChange={(e) => setKapat(e.target.checked)} /><span>Hesabımın kapatılacağını anladım.</span></label>
        <button className="btn hayir" disabled={!kapat} onClick={() => void yap(() => istek('/hesabim/kapatma-talebi', { onay: true }).then(() => { window.location.reload(); }), 'Hesabınız kapatıldı.')}>Hesabımı Kapat</button>
      </>}
      <h2 className="ara">E-Posta Değiştir</h2>
      <label htmlFor="ep-y">Yeni E-Posta</label><input id="ep-y" type="email" value={ep.yeni} onChange={(e) => setEp({ ...ep, yeni: e.target.value })} />
      <label htmlFor="ep-p">Parolanız</label><input id="ep-p" type="password" value={ep.parola} onChange={(e) => setEp({ ...ep, parola: e.target.value })} />
      <button className="btn2" disabled={!ep.yeni} onClick={() => void yap(() => istek('/profil/eposta-talep', { yeni: ep.yeni, parola: ep.parola }), 'Doğrulama kodu yeni adresinize gönderildi.')}>Kod Gönder</button>
      <label htmlFor="ep-k">Doğrulama Kodu</label><input id="ep-k" inputMode="numeric" value={ep.kod} onChange={(e) => setEp({ ...ep, kod: e.target.value })} />
      <button className="btn2" disabled={ep.kod.length !== 6} onClick={() => void yap(() => istek('/profil/eposta-onay', { kod: ep.kod }), 'E-posta adresiniz değiştirildi.')}>Doğrula</button>
      <h2 className="ara">Parola Değiştir</h2>
      <form className="dar-form" onSubmit={(e) => { e.preventDefault(); void yap(async () => { await istek('/kimlik/parola', { eski, yeni }); setEski(''); setYeni(''); }, 'Parolanız değiştirilmiştir.'); }}>
        <label htmlFor="pe">Mevcut Parola</label>
        <input id="pe" type="password" autoComplete="current-password" value={eski} onChange={(e) => setEski(e.target.value)} />
        <label htmlFor="py">Yeni Parola</label>
        <input id="py" type="password" autoComplete="new-password" value={yeni} onChange={(e) => setYeni(e.target.value)} />
        <div className="not">{[...yeni].length >= 12 ? '✔' : '○'} En Az 12 Karakter</div>
        <button className="btn" disabled={!eski || [...yeni].length < 12}>Parolamı Değiştir</button>
      </form>
    </>
  );
}
