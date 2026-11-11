import { useEffect, useState } from 'react';
import { istek, type Ben } from './api';
import { DosyaHaritasi, IsListeleri, KonumPlani } from './IsGorunumu';
import { GozdenGecirmeler } from './YonetimTakip';

export interface Kart {
  kimlik: string; tur: string; kategori: string; baslik: string; ozet: string | null; oncelik: string; son_zaman: string | null;
  kademe: number; kademe_sayisi: number; durum: string; makam?: string; sonraki_rol?: string | null; hazirlayan_adi?: string | null; gerekce?: string | null; vekaleten?: boolean;
}
export interface BugunVeri {
  zincirde?: (Kart & { makam?: string })[]; onay: Kart[]; islem: Kart[]; gorev: Kart[]; iade: Kart[]; gonderilmis: Kart[]; sureUyarilari: Kart[];
  duyurular: { kimlik: string; baslik: string; govde: string | null; zorunlu: boolean }[]; olaganustu: string | null; okunmamisBildirim: number; okunmamisMesaj: number; toplantilar: { kimlik: string; tpl_kod: string; konu: string; baslangic: string }[]; vekaletler: { kimlik: string; bitis: string; asil: string; rol: string }[];
}

const TZ = 'Europe/Istanbul';
const sonYazi = (s: string) => new Date(s).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).replace(',', '');

/** YG-1635: 5 güne kadar saat, üzeri gün. Süresi geçen kırmızı; renk yanıp sönmez. */
export function kalan(s: string, simdi = Date.now()): { yazi: string; sinif: string } {
  const ms = new Date(s).getTime() - simdi;
  if (ms < 0) return { yazi: `${Math.ceil(-ms / 3_600_000)} Saat Geçti`, sinif: 'kirmizi' };
  const saat = ms / 3_600_000;
  if (saat < 1) return { yazi: `${Math.max(1, Math.ceil(ms / 60_000))} Dakika Kaldı`, sinif: 'kirmizi' };
  if (saat <= 120) return { yazi: `${Math.ceil(saat)} Saat Kaldı`, sinif: saat <= 24 ? 'kirmizi' : 'sari' };
  return { yazi: `${Math.ceil(saat / 24)} Gün Kaldı`, sinif: 'gri' };
}

const ONCELIK: Record<string, string> = { Kritik: 'kirmizi', 'Yüksek': 'sari', Normal: 'gri', 'Planlı': 'gri' };
const Rozet = ({ s, c }: { s: string; c: string }) => <em className={`rozet ${s}`}>{c}</em>;
const Bos = ({ m }: { m: string }) => <div className="ozet bos">{m}</div>;

function KartUst({ k, sayac = true }: { k: Kart; sayac?: boolean }) {
  const kl = k.son_zaman ? kalan(k.son_zaman) : null;
  return (
    <>
      <div className="ust2"><b>{k.baslik}</b>{sayac && kl && <Rozet s={kl.sinif} c={kl.yazi} />}</div>
      {sayac && k.son_zaman && <div className="not son">Son: {sonYazi(k.son_zaman)}</div>}
      {k.oncelik !== 'Normal' && <div><Rozet s={ONCELIK[k.oncelik] ?? 'gri'} c={k.oncelik} /></div>}
      {k.ozet && <div className="not">{k.ozet}</div>}
    </>
  );
}

/** YG-1637: ara kademe Onaya Gönder, son makam Onayla / Reddet; iade ve ret gerekçelidir. */
function OnayKarti({ k, yenile }: { k: Kart; yenile: () => void }) {
  const [gerekce, setGerekce] = useState(''); const [acik, setAcik] = useState<'iade' | 'ret' | null>(null); const [hata, setHata] = useState(''); const [mesgul, setMesgul] = useState(false);
  const son = k.kademe === k.kademe_sayisi - 1;
  // YG-1649: dış kullanıcı hesap kurtarmasında makam "Teyit Et" / "Gerekçeyle İade Et" kullanır.
  const teyit = k.tur === 'Hesap Kurtarma Teyidi';
  const [kod, setKod] = useState(''); const [kodIste, setKodIste] = useState(false); // YG-222
  const ver = async (karar: string, g?: string) => {
    setHata(''); setMesgul(true);
    try { await istek(`/is/${k.kimlik}/karar`, { karar, gerekce: g, kod: kod || undefined }); yenile(); } catch (e) { setHata((e as Error).message); setKodIste(/doğrulama kodunu/.test((e as Error).message)); setMesgul(false); }
  };
  return (
    <div className="ozet kart-sol">
      <KartUst k={k} />
      {k.vekaleten && <div><Rozet s="gri" c="Vekâleten" /></div>}
      <div className="not">Kademe {k.kademe + 1} / {k.kademe_sayisi}{k.hazirlayan_adi ? ` · Hazırlayan: ${k.hazirlayan_adi}` : ''}</div>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {kodIste && <><label htmlFor={`kd-${k.kimlik}`}>Doğrulama Kodu</label><input id={`kd-${k.kimlik}`} inputMode="numeric" autoComplete="one-time-code" value={kod} onChange={(e) => setKod(e.target.value)} /></>}
      {acik ? (
        <div className="gerekce">
          <label htmlFor={`g${k.kimlik}`}>{acik === 'iade' ? 'İade Gerekçesi' : 'Red Gerekçesi'}</label>
          <textarea id={`g${k.kimlik}`} rows={2} value={gerekce} onChange={(e) => setGerekce(e.target.value)} placeholder="[Gerekçe]" />
          {acik === 'iade' && <div className="not">Kayıt, yazdığınız gerekçeyle hazırlayana düzeltilmek üzere geri döner.</div>}
          <div className="dugmeler">
            <button className="btn hayir" disabled={mesgul || !gerekce.trim()} onClick={() => void ver(acik === 'iade' ? 'Gerekçeyle İade Et' : 'Reddet', gerekce)}>{acik === 'iade' ? 'Gerekçeyle İade Et' : 'Reddet'}</button>
            <button className="btn2" onClick={() => { setAcik(null); setGerekce(''); }}>Vazgeç</button>
          </div>
        </div>
      ) : (
        <>
          {!son && <div className="not">Gönderilecek: <b className="koyu">{k.sonraki_rol}</b></div>}
          <div className="dugmeler">
            {son ? <button className="btn evet" disabled={mesgul} onClick={() => void ver('Onayla')}>{teyit ? 'Teyit Et' : 'Onayla'}</button> : <button className="btn" disabled={mesgul} onClick={() => void ver('Onaya Gönder')}>Onaya Gönder</button>}
            {son && !teyit && <button className="btn hayir" onClick={() => setAcik('ret')}>Reddet</button>}
            <button className="btn2" onClick={() => setAcik('iade')}>Gerekçeyle İade Et</button>
          </div>
        </>
      )}
    </div>
  );
}

function IslemKarti({ k, yenile }: { k: Kart; yenile: () => void }) {
  const [hata, setHata] = useState(''); const [er, setEr] = useState<{ yeniSon: string; gerekce: string } | null>(null);
  return (
    <div className="ozet kart-sol">
      <KartUst k={k} />
      {hata && <div className="hata" role="alert">{hata}</div>}
      <div className="dugmeler"><button className="btn2" onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Tamamlandı' }).then(yenile).catch((e) => setHata(e.message))}>Tamamlandı</button><button className="btn2" onClick={() => setEr(er ? null : { yeniSon: '', gerekce: '' })}>Ertele</button></div>
      {er && <div className="tam"><label htmlFor={`er-s-${k.kimlik}`}>Yeni Son Tarih</label><input id={`er-s-${k.kimlik}`} type="datetime-local" value={er.yeniSon} onChange={(e) => setEr({ ...er, yeniSon: e.target.value })} /><label htmlFor={`er-g-${k.kimlik}`}>Gerekçe</label><input id={`er-g-${k.kimlik}`} value={er.gerekce} onChange={(e) => setEr({ ...er, gerekce: e.target.value })} /><button className="btn2 kucuk" disabled={!er.yeniSon || !er.gerekce.trim()} onClick={() => void istek(`/is/${k.kimlik}/ertele`, { yeniSon: new Date(er.yeniSon).toISOString(), gerekce: er.gerekce }).then(yenile).catch((e) => setHata(e.message))}>Ertelemeyi Kaydet</button></div>}
    </div>
  );
}

/** YG-1631: 7 günlük plan İK modülüyle dolar; o zamana kadar gün şeridi boş görünür. */
function KonumSeridi() {
  const gunler = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86_400_000));
  return (
    <div className="konum7">{gunler.map((g) => (
      <div key={g.toISOString()}>
        <b>{g.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', timeZone: TZ })}</b>
        <span>{g.toLocaleDateString('tr-TR', { weekday: 'short', timeZone: TZ })}</span>
        <i>—</i>
      </div>
    ))}</div>
  );
}

/** YG-169: Direktör, GMY ve CEO, sırası gelmeyen işi gerekçeyle öne alabilir; atlanan kademeler bilgilenir. */
function KademeAtla({ k, yenile }: { k: Kart & { makam?: string }; yenile: () => void }) {
  const [g, setG] = useState(''); const [h, setH] = useState('');
  return <div className="ozet"><b>{k.baslik}</b><div className="not">Şu An: {k.makam}</div>{h && <div className="hata" role="alert">{h}</div>}<label htmlFor={`ka-${k.kimlik}`}>Gerekçe</label><input id={`ka-${k.kimlik}`} value={g} onChange={(e) => setG(e.target.value)} /><button className="btn2" disabled={!g.trim()} onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Kademe Atla', gerekce: g }).then(yenile).catch((x) => setH((x as Error).message))}>Kademeyi Atla</button></div>;
}

export function Bugun({ ben, veri, hata, yenile }: { ben: Ben; veri: BugunVeri | null; hata: string; yenile: () => void }) {
  const lgm = ben.grup === 'LGM İç Rolü';
  const [dHata, setDHata] = useState('');
  if (hata) return <div className="hata" role="alert">{hata}</div>;
  if (!veri) return null;
  const okudum = (id: string) => istek(`/duyuru/${id}/okudum`, {}).then(yenile).catch((e) => setDHata(e.message));
  const bugun = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: TZ });
  return (
    <>
      <div className="izgara-ust">
        {lgm && (
          <div className="ozet kur"><b>Piyasa Kuru · Bilgi Amaçlıdır</b><div>EUR — · USD — · GBP —</div></div>
        )}
        <div className="ozet duyuru">
          <b>Duyuru</b>
          {dHata && <div className="hata" role="alert">{dHata}</div>}
          {veri.duyurular.length === 0 && <div className="not">Yayında duyuru bulunmamaktadır.</div>}
          {veri.duyurular.map((d) => (
            <div key={d.kimlik} className="duyuru-satir">
              <div className="ust2"><span>{d.baslik}</span>{d.zorunlu && <Rozet s="kirmizi" c="Zorunlu" />}</div>
              {d.govde && <div className="not">{d.govde}</div>}
              {d.zorunlu && <button className="btn2 kucuk" onClick={() => void okudum(d.kimlik)}>Okudum</button>}
            </div>
          ))}
        </div>
      </div>

      <h1 className="selam">Hoş Geldiniz, {ben.adSoyad}</h1>
      <div className="not">{ben.roller.map((r) => <span key={r.kimlik}>{r.rol_adi}</span>)} · {bugun}</div>

      {veri.vekaletler.map((v) => (
        <div key={v.kimlik} className="ozet kart-sol">
          <div className="ust2"><b>Vekâleten Yürütülen İşler</b><Rozet s="gri" c={`Bitiş: ${v.bitis.split('-').reverse().join('.')}`} /></div>
          <div className="not">{v.rol} · {v.asil} Adına</div>
        </div>
      ))}

      {veri.toplantilar.length > 0 && <div className="bolum">Yaklaşan Toplantılar</div>}
      {veri.toplantilar.map((t) => (
        <div key={t.kimlik} className="ozet kart-sol">
          <div className="ust2"><b>{t.konu}</b><Rozet s="gri" c={new Date(t.baslangic).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })} /></div>
          <div className="not">{t.tpl_kod}</div>
        </div>
      ))}

      <div className="bolum">Süre Uyarıları</div>
      {veri.sureUyarilari.length === 0 ? <Bos m="Süresi yaklaşan işiniz bulunmamaktadır." /> : veri.sureUyarilari.map((k) => (
        <div key={k.kimlik} className="ozet kart-sol"><KartUst k={k} /></div>
      ))}

      {lgm && (<><div className="bolum">Planlanan Konumum · 7 Gün</div><KonumSeridi /></>)}

      <div className="bolum">Onayınızı Bekleyenler</div>
      {veri.onay.length === 0 ? <Bos m="Onayınızı bekleyen kayıt bulunmamaktadır." /> : veri.onay.map((k) => <OnayKarti key={k.kimlik} k={k} yenile={yenile} />)}

      <div className="bolum">İşleminizi Bekleyenler</div>
      {veri.islem.length === 0 ? <Bos m="İşleminizi bekleyen kayıt bulunmamaktadır." /> : veri.islem.map((k) => <IslemKarti key={k.kimlik} k={k} yenile={yenile} />)}

      {veri.iade.length > 0 && (<>
        <div className="bolum">İade Edilenler</div>
        {veri.iade.map((k) => (
          <div key={k.kimlik} className="ozet kart-sol">
            <KartUst k={k} sayac={false} />
            {k.gerekce && <div className="uyari"><b>İade Gerekçesi:</b> {k.gerekce}</div>}
            <div className="dugmeler"><button className="btn" onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Yeniden Gönder' }).then(yenile)}>Yeniden Gönder</button><button className="btn2" onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Geri Çek' }).then(yenile)}>Geri Çek</button></div>
          </div>
        ))}
      </>)}

      {(veri.zincirde ?? []).length > 0 && (<>
        <div className="bolum">Silsilenizde Bekleyenler</div>
        {(veri.zincirde ?? []).map((k) => <KademeAtla key={k.kimlik} k={k} yenile={yenile} />)}
      </>)}
      {veri.gonderilmis.length > 0 && (<>
        <div className="bolum">Onaya Gönderilmiş İşlemlerim</div>
        {veri.gonderilmis.map((k) => (
          <div key={k.kimlik} className="ozet kart-sol">
            <div className="ust2"><b>{k.baslik}</b><Rozet s="gri" c={`Kademe ${k.kademe + 1} / ${k.kademe_sayisi}`} /></div>
            <div className="not">{k.makam} Kontrolünde</div>
          </div>
        ))}
      </>)}

      <div className="bolum">Görevler ve Periyodik İşler</div>
      {veri.gorev.length === 0 ? <Bos m="Bugün için görev bulunmamaktadır." /> : veri.gorev.map((k) => <IslemKarti key={k.kimlik} k={k} yenile={yenile} />)}
      {lgm && <><GozdenGecirmeler /><IsListeleri /><KonumPlani /><DosyaHaritasi /></>}
    </>
  );
}

interface Bildirim { kimlik: string; zaman: string; baslik: string; ozet: string | null; okunma_zamani: string | null }

/** YG-1626: tarih-saatiyle, okunmamışlar önde. */
export function Bildirimler({ yenile }: { yenile: () => void }) {
  const [l, setL] = useState<Bildirim[] | null>(null);
  const [hata, setHata] = useState('');
  useEffect(() => { istek<Bildirim[]>('/bildirimler').then(setL).catch((e) => setHata(e.message)); }, []);
  const hepsi = () => istek('/bildirimler/okundu', {}).then(() => { yenile(); return istek<Bildirim[]>('/bildirimler'); }).then(setL).catch((e) => setHata(e.message));
  return (
    <>
      <h1>Bildirimler</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {l?.length === 0 && <Bos m="Bildirim bulunmamaktadır." />}
      {l?.some((b) => !b.okunma_zamani) && <button className="btn2 kucuk" onClick={() => void hepsi()}>Tümünü Okundu İşaretle</button>}
      {l?.map((b) => (
        <div key={b.kimlik} className={`ozet ${b.okunma_zamani ? 'okundu' : 'kart-sol'}`}>
          <div className="ust2"><b>{b.baslik}</b>{!b.okunma_zamani && <Rozet s="sari" c="Yeni" />}</div>
          <div className="not son">{sonYazi(b.zaman)}</div>
          {b.ozet && <div className="not">{b.ozet}</div>}
        </div>
      ))}
    </>
  );
}
