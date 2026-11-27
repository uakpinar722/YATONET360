import { NedenBaglantisi } from './Neden';
import { BelgeSec } from './Kalite';
import { KapasiteIstisnaKarar } from './KapasiteIstisnasi';
import { DosyaBag } from './DosyaBag';
import { eur, tarih } from './bicim';
import { useEffect, useState } from 'react';
import { istek, type Ben } from './api';
import { DosyaHaritasi, IsListeleri, KonumPlani } from './IsGorunumu';
import { GozdenGecirmeler } from './YonetimTakip';
import { OzelGunler } from './OzelGunler';

export interface Kart {
  kimlik: string; tur: string; kategori: string; baslik: string; ozet: string | null; oncelik: string; son_zaman: string | null; sure_notu?: string | null; olusturma_zamani?: string; ortak_statu?: string; beklemede?: boolean; gecikmis?: boolean;
  kademe: number; kademe_sayisi: number; durum: string; makam?: string; sonraki_rol?: string | null; hazirlayan_adi?: string | null; gerekce?: string | null; vekaleten?: boolean; arz_notlari?: string | null;
}
export interface BugunVeri {
  zincirde?: (Kart & { makam?: string })[]; onay: Kart[]; islem: Kart[]; gorev: Kart[]; iade: Kart[]; gonderilmis: Kart[]; sureUyarilari: Kart[];
  duyurular: { kimlik: string; baslik: string; govde: string | null; zorunlu: boolean; tur?: string; ek_belge_ref?: string | null; ek_surum?: number | null }[]; ozelGunler?: { ad: string; gun: string; tur: string }[]; olaganustu: string | null; okunmamisBildirim: number; okunmamisMesaj: number; toplantilar: { kimlik: string; tpl_kod: string; konu: string; baslangic: string }[]; baskanlik?: { kimlik: string; tpl_kod: string; konu: string; baslangic: string; kapanis_bekliyor: boolean; tutanak_var: boolean; katilimci: number }[]; tamamlanan?: { kimlik: string; tur: string; baslik: string; durum: string; kapanma_zamani: string }[]; takvim?: { zaman: string; baslik: string; tur: string }[]; vekaletler: { kimlik: string; bitis: string; asil: string; rol: string }[];
}

const TZ = 'Europe/Istanbul';
const sonYazi = (s: string) => new Date(s).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).replace(',', '');

/** YG-1635: 5 güne kadar saat, üzeri gün. Süresi geçen kırmızı; renk yanıp sönmez. */
/** YG-224, K-139: tedarikçinin sistem erişimi yoksa siparişi hazırlayan ıslak imzalı kabul belgesini kaydeder. */
function SiparisIslakKabul({ kimlik, dosya }: { kimlik: string; dosya: string }) {
  const [g, setG] = useState(''); const [bl, setBl] = useState(''); const [ts, setTs] = useState(''); const [m, setM] = useState('');
  return <details><summary>Tedarikçinin Sistem Erişimi Yok · Islak İmzalı Kabul</summary>{m && <div className="not" role="status">{m}</div>}<BelgeSec ad="Islak İmzalı Sipariş Kabulü" bagTuru="Dosya" bagKimligi={dosya} deger={bl} sec={setBl} />
    <label htmlFor={`sik-t-${kimlik}`}>Taahhüt Edilen Teslim Tarihi</label><input id={`sik-t-${kimlik}`} type="date" value={ts} onChange={(e) => setTs(e.target.value)} />
    <label htmlFor={`sik-g-${kimlik}`}>Gerekçe</label><input id={`sik-g-${kimlik}`} value={g} onChange={(e) => setG(e.target.value)} />
    <button className="btn2 kucuk" disabled={!g.trim() || !bl || !ts} onClick={() => void istek(`/tedarik-siparisi/${kimlik}/islak-imza-kabul`, { gerekce: g.trim(), belge: bl, teslim: ts }).then(() => setM('Islak imzalı kabul kaydedildi.')).catch((e) => setM(e.message))}>Kabulü Kaydet</button></details>;
}

export function kalan(s: string, simdi = Date.now(), baslangic?: string): { yazi: string; sinif: string; yanip?: string } {
  const ms = new Date(s).getTime() - simdi;
  if (ms < 0) { const dk = Math.ceil(-ms / 60_000); return { yazi: `${Math.floor(dk / 60)} Saat ${dk % 60} Dakika Geçti`, sinif: 'kirmizi', yanip: 'yanip-gecti' }; }
  const yanip = ms <= 1_800_000 ? 'yanip-1' : ms <= 3_600_000 ? 'yanip-3' : ms <= 7_200_000 ? 'yanip-5' : undefined; // YG-1606
  if (yanip) return { ...kalanYazi(ms), yanip };
  const r = kalanYazi(ms, new Date(s), simdi);
  // YG-1755: kalan süre toplam sürenin dörtte birine inince sarı olur (kırmızı eşikleri aynen kalır).
  if (baslangic && r.sinif === 'gri') { const top = new Date(s).getTime() - new Date(baslangic).getTime(); if (top > 0 && ms <= top / 4) return { ...r, sinif: 'sari' }; }
  return r;
}
/** YG-1605: 120 saatin üzerinde gün sayısı İstanbul takvim günü değişiminde (00:00) bir azalır. */
const takvimGunu = (d: Date) => Date.parse(`${d.toLocaleDateString('sv-SE', { timeZone: TZ })}T00:00:00Z`) / 86_400_000;
function kalanYazi(ms: number, bitis?: Date, simdi = Date.now()): { yazi: string; sinif: string } {
  const saat = ms / 3_600_000;
  if (saat < 1) return { yazi: `${Math.max(1, Math.ceil(ms / 60_000))} Dakika Kaldı`, sinif: 'kirmizi' };
  if (saat <= 120) return { yazi: `${Math.ceil(saat)} Saat Kaldı`, sinif: saat <= 24 ? 'kirmizi' : 'gri' }; // YG-1755: sarı dörtte bir kuralıyla
  return { yazi: `${bitis ? takvimGunu(bitis) - takvimGunu(new Date(simdi)) : Math.ceil(saat / 24)} Gün Kaldı`, sinif: 'gri' };
}

const ONCELIK: Record<string, string> = { Kritik: 'kirmizi', 'Yüksek': 'sari', Normal: 'gri', 'Planlı': 'gri' };
const Rozet = ({ s, c, y }: { s: string; c: string; y?: string }) => <em className={`rozet ${s}${y ? ` ${y}` : ''}`}>{c}</em>;
const Bos = ({ m }: { m: string }) => <div className="ozet bos">{m}</div>;

function KartUst({ k, sayac = true }: { k: Kart; sayac?: boolean }) {
  const kl = k.son_zaman ? kalan(k.son_zaman, Date.now(), k.olusturma_zamani) : null;
  return (
    <>
      <div className="ust2"><b>{k.baslik}</b>{sayac && kl && <Rozet s={kl.sinif} c={kl.yazi} y={kl.yanip} />}</div>
      {(k.ortak_statu || k.beklemede || k.gecikmis) && <div>{k.ortak_statu && <Rozet s="gri" c={k.ortak_statu} />}{k.beklemede && <Rozet s="sari" c="Beklemede" />}{k.gecikmis && <Rozet s="kirmizi" c="Gecikmiş" />}</div>}
      {sayac && k.son_zaman && <div className="not son">Son: {sonYazi(k.son_zaman)}{k.sure_notu ? ` · ${k.sure_notu}` : ''}</div>}
      {k.oncelik !== 'Normal' && <div><Rozet s={ONCELIK[k.oncelik] ?? 'gri'} c={k.oncelik} /></div>}
      {k.ozet && <div className="not">{k.ozet}</div>}
    </>
  );
}

/** YG-1592, YG-1593: sipariş onayında sistem kontrolleri ve tutara göre son onay makamı. */
/** YG-1584: nöbet çizelgesi onay ekranı; vardiyalar ve kontroller. */
function NobetCizelgesiAyrinti({ id }: { id: string }) {
  const [v, setV] = useState<{ donem: string; surum: number; vardiyalar: { katman: string; ad_soyad: string; baslangic: string; bitis: string }[]; kontroller: { ad: string; sonuc: boolean; aciklama: string }[] } | null>(null); const [ac, setAc] = useState(false);
  useEffect(() => { void istek<NonNullable<typeof v>>(`/is/${id}/nobet-cizelgesi`).then(setV).catch(() => setV(null)); }, [id]);
  if (!v) return null;
  const z = (x: string) => new Date(x).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
  return <div className="tam">{v.kontroller.map((x) => <div key={x.ad} className={x.sonuc ? 'not' : 'hata'}>{x.sonuc ? '✓' : '✗'} {x.ad} · {x.aciklama}</div>)}
    <button className="lnk" onClick={() => setAc(!ac)}>{ac ? 'Vardiyaları Gizle' : `Vardiyaları Göster (${v.vardiyalar.length})`}</button>
    {ac && v.vardiyalar.map((x, n) => <div key={n} className="not">{x.katman} · {x.ad_soyad} · {z(x.baslangic)} – {z(x.bitis)}</div>)}</div>;
}

function SiparisKontrolleri({ id }: { id: string }) {
  const [v, setV] = useState<{ kdvHaric: number; sonMakam: string | null; kontroller: { ad: string; sonuc: boolean; aciklama: string }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>(`/is/${id}/siparis-kontrolleri`).then(setV).catch(() => setV(null)); }, [id]);
  if (!v) return null;
  return <div className="not">{v.kontroller.map((x) => <div key={x.ad}>{x.sonuc ? '✓' : '⚠'} <b>{x.ad}:</b> {x.aciklama}</div>)}{v.sonMakam && <div>Son Onay Makamı (tutara göre): <b className="koyu">{v.sonMakam}</b></div>}</div>;
}

/** YG-1637: ara kademe Onaya Gönder, son makam Onayla / Reddet; iade ve ret gerekçelidir. */
function OnayKarti({ k, yenile }: { k: Kart; yenile: () => void }) {
  const [gerekce, setGerekce] = useState(''); const [acik, setAcik] = useState<'iade' | 'ret' | null>(null); const [hata, setHata] = useState(''); const [mesgul, setMesgul] = useState(false);
  const son = k.kademe === k.kademe_sayisi - 1;
  // YG-1649: dış kullanıcı hesap kurtarmasında makam "Teyit Et" / "Gerekçeyle İade Et" kullanır.
  const teyit = k.tur === 'Hesap Kurtarma Teyidi';
  const [kod, setKod] = useState(''); const [kodIste, setKodIste] = useState(false); // YG-222
  const [donus, setDonus] = useState(''); // YG-153
  const ver = async (karar: string, g?: string) => {
    setHata(''); setMesgul(true);
    try { await istek(`/is/${k.kimlik}/karar`, { karar, gerekce: g, kod: kod || undefined, donulecekKademe: karar === 'Gerekçeyle İade Et' && donus !== '' ? Number(donus) : undefined }); yenile(); } catch (e) { setHata((e as Error).message); setKodIste(/doğrulama kodunu/.test((e as Error).message)); setMesgul(false); }
  };
  return (
    <div className="ozet kart-sol">
      <KartUst k={k} />
      {k.vekaleten && <div><Rozet s="gri" c="Vekâleten" /></div>}
      <NedenBaglantisi tur={k.tur} />{/* YG-1387 */}
      <div className="not">Kademe {k.kademe + 1} / {k.kademe_sayisi}{k.hazirlayan_adi ? ` · Hazırlayan: ${k.hazirlayan_adi}` : ''}</div>
      {k.arz_notlari && <div className="not">Önceki Kademe Notları: {k.arz_notlari}</div>}
      {k.tur === 'Tedarik Siparişi' && <SiparisKontrolleri id={k.kimlik} />}
      {k.tur === 'Nöbet Çizelgesi' && <NobetCizelgesiAyrinti id={k.kimlik} />}
      {hata && <div className="hata" role="alert">{hata}</div>}
      {kodIste && <><label htmlFor={`kd-${k.kimlik}`}>Doğrulama Kodu</label><input id={`kd-${k.kimlik}`} inputMode="numeric" autoComplete="one-time-code" value={kod} onChange={(e) => setKod(e.target.value)} /></>}
      {acik ? (
        <div className="gerekce">
          <label htmlFor={`g${k.kimlik}`}>{acik === 'iade' ? 'İade Gerekçesi' : 'Red Gerekçesi'}</label>
          <textarea required id={`g${k.kimlik}`} rows={2} value={gerekce} onChange={(e) => setGerekce(e.target.value)} placeholder="[Gerekçe]" />
          {acik === 'iade' && k.kademe > 0 && <><label htmlFor={`dk-${k.kimlik}`}>Geri Dönülecek Aşama</label><select id={`dk-${k.kimlik}`} value={donus} onChange={(e) => setDonus(e.target.value)}><option value="">Hazırlayan (düzeltme için)</option>{Array.from({ length: k.kademe }, (_, n) => <option key={n} value={n}>{`Kademe ${n + 1}`}</option>)}</select></>}
          {acik === 'iade' && <div className="not">{donus === '' ? 'Kayıt, yazdığınız gerekçeyle hazırlayana düzeltilmek üzere geri döner.' : `Kayıt, gerekçenizle Kademe ${Number(donus) + 1} makamına geri döner.`}</div>}
          <div className="dugmeler">
            <button className="btn hayir" disabled={mesgul || !gerekce.trim()} onClick={() => void ver(acik === 'iade' ? 'Gerekçeyle İade Et' : 'Reddet', gerekce)}>{acik === 'iade' ? 'Gerekçeyle İade Et' : 'Reddet'}</button>
            <button className="btn2" onClick={() => { setAcik(null); setGerekce(''); }}>Vazgeç</button>
          </div>
        </div>
      ) : (
        <>
          {!son && <div className="not">Gönderilecek: <b className="koyu">{k.sonraki_rol}</b></div>}
          {!son && <><label htmlFor={`an-${k.kimlik}`}>Not (İsteğe Bağlı)</label><input required id={`an-${k.kimlik}`} value={gerekce} onChange={(e) => setGerekce(e.target.value)} /></>}
          <div className="dugmeler">
            {son ? <button className="btn evet" disabled={mesgul} onClick={() => void ver('Onayla')}>{teyit ? 'Teyit Et' : 'Onayla'}</button> : <button className="btn evet" disabled={mesgul} onClick={() => void ver('Onaya Gönder', gerekce.trim() || undefined)}>{k.tur === 'Masraf Fişi' ? 'Uygundur' : 'Onaya Gönder'}</button>}
            {son && !teyit && <button className="btn hayir" onClick={() => setAcik('ret')}>Reddet</button>}
            <button className="btn2 hayir" onClick={() => setAcik('iade')}>Gerekçeyle İade Et</button>
          </div>
        </>
      )}
    </div>
  );
}

const INCELEME = ['Aylık İSG Göstergeleri', 'Aylık Destek İstatistiği', 'Haftalık Uygunsuzluk Süre Raporu']; // YG-1694: is_motoru.ts INCELEME_TURLERI
function IslemKarti({ k, yenile }: { k: Kart; yenile: () => void }) {
  const [hata, setHata] = useState(''); const [er, setEr] = useState<{ yeniSon: string; gerekce: string } | null>(null);
  return (
    <div className="ozet kart-sol">
      <KartUst k={k} />
      {hata && <div className="hata" role="alert">{hata}</div>}
      {INCELEME.includes(k.tur) && <div className="not">İncelediğiniz kayda geçer; gönderen kişiye bilgi gider.</div>}
      <div className="dugmeler">{INCELEME.includes(k.tur) ? <button className="btn2" title="İncelediğiniz kayda geçer; gönderen kişiye bilgi gider." onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'İncelendi' }).then(yenile).catch((e) => setHata(e.message))}>İncelendi Olarak Kaydet</button> : <button className="btn2" onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Tamamlandı' }).then(yenile).catch((e) => setHata(e.message))}>Tamamlandı</button>}<button className="btn2" onClick={() => setEr(er ? null : { yeniSon: '', gerekce: '' })}>Ertele</button></div>
      {er && <div className="tam"><label htmlFor={`er-s-${k.kimlik}`}>Yeni Son Tarih</label><input required id={`er-s-${k.kimlik}`} type="datetime-local" value={er.yeniSon} onChange={(e) => setEr({ ...er, yeniSon: e.target.value })} /><label htmlFor={`er-g-${k.kimlik}`}>Gerekçe</label><input required id={`er-g-${k.kimlik}`} value={er.gerekce} onChange={(e) => setEr({ ...er, gerekce: e.target.value })} /><button className="btn2 kucuk" disabled={!er.yeniSon || !er.gerekce.trim()} onClick={() => void istek(`/is/${k.kimlik}/ertele`, { yeniSon: new Date(er.yeniSon).toISOString(), gerekce: er.gerekce }).then(yenile).catch((e) => setHata(e.message))}>Ertelemeyi Kaydet</button></div>}
    </div>
  );
}

/** YG-1631: 7 günlük plan İK modülüyle dolar; o zamana kadar gün şeridi boş görünür. */
/** YG-1631: 7 günlük planlanan konum; veri kişinin konum planından (görev, izin, saha) gelir. */
/** YG-1369: çevrim dışı kayıt çakışmaları; süreç sahibi platform kaydını esas alır veya cihaz kaydını uygular. */
function CevrimDisiCakismalar() {
  const [l, setL] = useState<{ kimlik: string; gonderen: string; dosya_no: string | null; zaman: string }[]>([]); const [n, setN] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/mobil/cakismalar').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (l.length === 0) return m ? <div className="not" role="status">{m}</div> : null;
  const karar = (k: string, karar: string) => void istek(`/mobil/cakisma/${k}/karar`, { karar, gerekce: n[k] ?? '' }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  return <>{m && <div className="not" role="status">{m}</div>}{l.map((x) => <div key={x.kimlik} className="kart-sol" data-t="cevrim-disi-cakisma"><b>Çevrim Dışı Kayıt Çakışması · {x.dosya_no ?? 'Saha'} · {x.gonderen}</b>
    <div className="not">Kayıt {tarih(x.zaman)} tarihinde cihazdan geldi; platformdaki kayıt bu arada değişti.</div>
    <label htmlFor={`cd-${x.kimlik}`}>Gerekçe</label><input id={`cd-${x.kimlik}`} value={n[x.kimlik] ?? ''} onChange={(e) => setN({ ...n, [x.kimlik]: e.target.value })} />
    <div className="dugmeler"><button className="btn" disabled={!(n[x.kimlik] ?? '').trim()} onClick={() => karar(x.kimlik, 'Platform Kaydı Esas')}>Platform Kaydını Esas Al</button><button className="btn evet" disabled={!(n[x.kimlik] ?? '').trim()} onClick={() => karar(x.kimlik, 'Cihaz Kaydı Uygulansın')}>Cihaz Kaydını Uygula</button></div></div>)}</>;
}

/** YG-1582, YG-1586, YG-1587: yanıtsız kalıp size yükselen nöbet çağrısı; 15 dakikalık dönüş sayacıyla. */
function YukselenCagri() {
  const [l, setL] = useState<{ kimlik: string; hat: string; arayan: string; telefon: string | null; ozet: string; sorumlu_rol: string; son_zaman: string }[]>([]); const [n, setN] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/nobet/yukselen-cagrilarim').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (l.length === 0) return m ? <div className="not" role="status">{m}</div> : null;
  return <>{m && <div className="not" role="status">{m}</div>}{l.map((x) => { const kl = kalan(x.son_zaman); return <div key={x.kimlik} className="hata kart-sol" data-t="yukselen-cagri"><div className="ust2"><b>Yükselen Çağrı · {x.hat} Hattı · {x.arayan}</b><Rozet s={kl.sinif} y={kl.yanip} c={kl.yazi} /></div>
    <div className="not">{x.ozet}{x.telefon ? ` · ${x.telefon}` : ''} · Önceki katman yanıt vermedi; arayana dönmenizi rica ederiz.</div>
    <label htmlFor={`yc-${x.kimlik}`}>Görüşme Notu</label><input id={`yc-${x.kimlik}`} value={n[x.kimlik] ?? ''} onChange={(e) => setN({ ...n, [x.kimlik]: e.target.value })} />
    <div className="dugmeler"><button className="btn evet" disabled={!(n[x.kimlik] ?? '').trim()} onClick={() => void istek(`/nobet/cagri/${x.kimlik}/donus`, { not: n[x.kimlik] }).then(() => { setM('Dönüş kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Döndüm</button></div></div>; })}</>;
}

/** YG-1584: olay yöneticisi olduğunuz açık olaylar; bilgilendirilecek makamlar hatırlatılır. */
function OlayYoneticisiKarti() {
  const [l, setL] = useState<{ kimlik: string; olay_no: string; olay_turu: string; ozet: string; dosya_no: string | null; bilgilendir: string[] }[]>([]);
  useEffect(() => { void istek<typeof l>('/olay/yoneticisi-oldugum').then(setL).catch(() => setL([])); }, []);
  if (l.length === 0) return null;
  return <>{l.map((x) => <div key={x.kimlik} className="hata kart-sol" data-t="olay-yoneticisi"><div className="ust2"><b>Olay Yöneticisi: Siz · {x.olay_no}</b><Rozet s="kirmizi" c="Acil" /></div>
    <div className="not">{x.olay_turu}{x.dosya_no ? ` · ${x.dosya_no}` : ''} · {x.ozet}</div>
    <div className="not">Bilgilendiriniz: {x.bilgilendir.join(', ')}</div>
    <OlayYonetimi x={x} yenile={() => void istek<typeof l>('/olay/yoneticisi-oldugum').then(setL).catch(() => setL([]))} /></div>)}</>;
}

/** YG-264: olayı devralma ve süreklilik seviyesi kaydı. */
function OlayYonetimi({ x, yenile }: { x: { kimlik: string; ben?: boolean; yonetici?: string | null; sureklilik_seviyesi?: string | null; seviyeler?: string[] }; yenile: () => void }) {
  const [s, setS] = useState(x.sureklilik_seviyesi ?? ''); const [m, setM] = useState('');
  const is = (p: Promise<unknown>) => void p.then(() => { setM('Kaydedildi.'); yenile(); }).catch((e) => setM((e as Error).message));
  return <>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Olay Yöneticisi: {x.yonetici ?? 'Devralınmadı'}{x.sureklilik_seviyesi ? ` · Süreklilik Seviyesi: ${x.sureklilik_seviyesi}` : ''}</div>
    {!x.ben ? <button className="btn2 kucuk" onClick={() => is(istek(`/olay/${x.kimlik}/devral`, {}))}>Olayı Devral</button>
      : <div className="dugmeler"><label htmlFor={`ss-${x.kimlik}`}>Süreklilik Seviyesi</label><select id={`ss-${x.kimlik}`} value={s} onChange={(e) => setS(e.target.value)}><option value="">Seçiniz</option>{(x.seviyeler ?? []).map((v) => <option key={v}>{v}</option>)}</select>
        <button className="btn2 kucuk" disabled={!s || s === x.sureklilik_seviyesi} onClick={() => is(istek(`/olay/${x.kimlik}/sureklilik`, { seviye: s }))}>Seviyeyi Kaydet</button></div>}</>;
}

/** YG-1579, YG-246: size devredilen ve henüz onaylanmamış nöbet; açık olaylarla birlikte acil kartların üstünde. */
function NobetDevirKarti() {
  const [l, setL] = useState<{ kimlik: string; devreden: string; acik_olaylar: string | null; kontrol_listesi: string[] | null }[]>([]); const [m, setM] = useState('');
  const yk = () => istek<{ bekleyen: typeof l }>('/nobet/devir').then((r) => setL(r.bekleyen)).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (l.length === 0) return m ? <div className="not" role="status">{m}</div> : null;
  return <><div className="bolum">Nöbet Devir Kaydı</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="hata kart-sol" data-t="nobet-devir-karti"><div className="ust2"><b>{x.devreden} nöbeti size devretti</b><Rozet s="kirmizi" c="Nöbet" /></div>
      {x.acik_olaylar && <div className="not">Açık Olaylar: {x.acik_olaylar}</div>}
      {Array.isArray(x.kontrol_listesi) && x.kontrol_listesi.length > 0 && <div className="not">Devredilen: {x.kontrol_listesi.join(', ')}</div>}
      <div className="dugmeler"><button className="btn evet" onClick={() => void istek(`/nobet/devir/${x.kimlik}/onayla`, {}).then(() => { setM('Nöbet devri onaylandı.'); return yk(); }).catch((e) => setM(e.message))}>Devraldım</button></div></div>)}</>;
}

function KonumSeridi() {
  const [p, setP] = useState<{ tarih: string; konum: string }[]>([]);
  useEffect(() => { void istek<{ tarih: string; konum: string }[]>('/konum-plani/ben').then(setP).catch(() => setP([])); }, []);
  const gunler = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86_400_000));
  return (
    <div className="konum7">{gunler.map((g) => (
      <div key={g.toISOString()}>
        <b>{g.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', timeZone: TZ })}</b>
        <span>{g.toLocaleDateString('tr-TR', { weekday: 'short', timeZone: TZ })}</span>
        <i>{p.find((x) => x.tarih === g.toLocaleDateString('sv-SE', { timeZone: TZ }))?.konum || '—'}</i>
      </div>
    ))}</div>
  );
}

/** YG-169: Direktör, GMY ve CEO, sırası gelmeyen işi gerekçeyle öne alabilir; atlanan kademeler bilgilenir. */
function KademeAtla({ k, yenile }: { k: Kart & { makam?: string }; yenile: () => void }) {
  const [g, setG] = useState(''); const [h, setH] = useState('');
  return <div className="ozet"><b>{k.baslik}</b><div className="not">Şu An: {k.makam}</div>{h && <div className="hata" role="alert">{h}</div>}<label htmlFor={`ka-${k.kimlik}`}>Gerekçe</label><input required id={`ka-${k.kimlik}`} value={g} onChange={(e) => setG(e.target.value)} /><button className="btn2" disabled={!g.trim()} onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Kademe Atla', gerekce: g }).then(yenile).catch((x) => setH((x as Error).message))}>Kademeyi Atla</button></div>;
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
          <KurSeridi />
        )}
        <div className="ozet duyuru">
          <b>Duyuru</b>
          {dHata && <div className="hata" role="alert">{dHata}</div>}
          {veri.duyurular.filter((d) => d.tur !== 'Özel Gün').length === 0 && <div className="not">Yayında duyuru bulunmamaktadır.</div>}
          {veri.duyurular.filter((d) => d.tur !== 'Özel Gün').map((d) => (
            <div key={d.kimlik} className="duyuru-satir">
              <div className="ust2"><span>{d.baslik}</span>{d.zorunlu && <Rozet s="kirmizi" c="Zorunlu" />}</div>
              {d.govde && <div className="not">{d.govde}</div>}
              {d.ek_belge_ref && d.ek_surum && <a className="not" href={`/api/belge/${d.ek_belge_ref}/surum/${d.ek_surum}/indir`}>Eki İndir</a>}
              {d.zorunlu && <button className="btn2 kucuk" onClick={() => void okudum(d.kimlik)}>Okudum</button>}
            </div>
          ))}
        </div>
        {((veri.ozelGunler?.length ?? 0) > 0 || veri.duyurular.some((d) => d.tur === 'Özel Gün')) && (
          <div className="ozet duyuru" data-t="ozel-gunler">
            <b>Özel Günler</b>
            {veri.duyurular.filter((d) => d.tur === 'Özel Gün').map((d) => <div key={d.kimlik} className="duyuru-satir"><div className="ust2"><span>{d.baslik}</span></div>{d.govde && <div className="not">{d.govde}</div>}</div>)}
            {veri.ozelGunler?.map((x) => <div key={`${x.ad}-${x.gun}-${x.tur}`}>{x.gun.slice(3)}.{x.gun.slice(0, 2)} · {x.ad} · {x.tur}</div>)}
          </div>
        )}
      </div>

      <h1 className="selam">Hoş Geldiniz, {ben.adSoyad}</h1>
      <div className="not">{ben.roller.map((r) => <span key={r.kimlik}>{r.rol_adi}</span>)} · {bugun}</div>

      {veri.vekaletler.map((v) => (
        <div key={v.kimlik} className="ozet kart-sol">
          <div className="ust2"><b>Vekâleten Yürütülen İşler</b><Rozet s="gri" c={`Bitiş: ${v.bitis.split('-').reverse().join('.')}`} /></div>
          <div className="not">{v.rol} · {v.asil} Adına</div>
        </div>
      ))}

      <div className="bolum">Yaklaşan Toplantılar</div>{veri.toplantilar.length === 0 && <Bos m="Yaklaşan toplantınız bulunmamaktadır." />}
      {veri.toplantilar.map((t) => (
        <div key={t.kimlik} className="ozet kart-sol">
          <div className="ust2"><b>{t.konu}</b><Rozet s="gri" c={new Date(t.baslangic).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })} /></div>
          <div className="not">{t.tpl_kod}</div>
        </div>
      ))}

      {(veri.baskanlik?.length ?? 0) > 0 && <>{/* YG-1586: Toplantı Başkanlığı */}
        <div className="bolum">Toplantı Başkanlığı</div>
        {veri.baskanlik!.map((t) => <div key={t.kimlik} className="ozet kart-sol">
          <div className="ust2"><b>{t.konu}</b>{t.kapanis_bekliyor ? <Rozet s="sari" c={t.tutanak_var ? 'Kapanış Bekliyor' : 'Tutanak Bekliyor'} /> : <Rozet s="gri" c={new Date(t.baslangic).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })} />}</div>
          <div className="not">{t.tpl_kod} · {t.katilimci} katılımcı · {t.kapanis_bekliyor ? 'Kararları ve tutanağı Toplantılar sayfasından kaydedip toplantıyı kapatınız.' : 'Başkanı olduğunuz toplantı.'}</div>
        </div>)}</>}

      {ben.roller.some((r) => ['Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'].includes(r.rol_adi)) && <AskiAcikIsler />}
      {ben.roller.some((r) => r.rol_adi === 'Sicil Sorumlusu') && <SuresiDolmusBelgeler />}
      {ben.roller.some((r) => ['Sicil Sorumlusu', 'Firma Yönetimi Müdürü', 'Firma Yönetimi Müdür Yardımcısı'].includes(r.rol_adi)) && <SicilKalitesi />}
      <DonemKartlari />
      <FirmaDenetimPlani />
      {ben.roller.some((r) => ['Firma Yönetimi Yöneticisi', 'Firma Yönetimi Müdür Yardımcısı', 'Firma Yönetimi Müdürü'].includes(r.rol_adi)) && <KabulSistemi />}
      {ben.roller.some((r) => r.rol_adi === 'Hukuk ve Uyum Direktörü') && <HukukGorusleri />}
      {ben.roller.some((r) => ['Teknik Müdür', 'İSG Sorumlusu'].includes(r.rol_adi)) && <BirimGorusleri />}
      {ben.roller.some((r) => r.rol_adi === 'İSG Sorumlusu') && <IsgIsiDurdur />}
      {lgm && <SikayetTeknikGorusleri />}
      {lgm && <KanitTaleplerim />}
      {ben.roller.some((r) => ['İç Denetçi', 'İç Denetim Müdürü'].includes(r.rol_adi)) && <OrneklemIncelemelerim />}
      {ben.roller.some((r) => ['Hukuk ve Uyum Direktörü', 'Hukuk ve Uyum Uzmanı'].includes(r.rol_adi)) && <YurtDisiUygunluk />}
      {ben.roller.some((r) => r.rol_adi === 'Bilgi Teknolojileri ve Firma Yönetimi Direktörü') && <KabulItirazlari />}
      {ben.roller.some((r) => r.rol_adi === 'Muhasebe ve Finans Müdür Yardımcısı') && <MaliKontrol />}
      {ben.roller.some((r) => r.rol_adi === 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)') && <SigortaTutarKontrol />}
      {ben.roller.some((r) => r.rol_adi === 'Teknik ve Operasyon Direktörü') && <KapasiteIstisnaKarar />}
      {ben.roller.some((r) => ['Tedarik Müdür Yardımcısı', 'Tedarik Yönetimi Müdürü'].includes(r.rol_adi)) && <TedarikGostergeleri />}
      {ben.roller.some((r) => ['Tedarik Müdür Yardımcısı', 'Tedarik Yönetimi Müdürü'].includes(r.rol_adi)) && <KaynakRisk mudur={ben.roller.some((r) => r.rol_adi === 'Tedarik Yönetimi Müdürü')} />}
      {ben.roller.some((r) => r.rol_adi === 'Operasyon Müdürü') && <MudurlukGostergeleri />}
      {ben.roller.some((r) => ['Kalite Yöneticisi', 'Kalite Müdür Yardımcısı', 'Kalite Müdürü'].includes(r.rol_adi)) && <EksikKontrolKayitlari />}
      {ben.roller.some((r) => ['Kalite Müdür Yardımcısı', 'Kalite Müdürü'].includes(r.rol_adi)) && <KaliteVeriDogrulama />}
      {ben.roller.some((r) => ['Risk ve Kalite Direktörü', 'Kalite Müdürü'].includes(r.rol_adi)) && <OlayIzleme rkd={ben.roller.some((r) => r.rol_adi === 'Risk ve Kalite Direktörü')} km={ben.roller.some((r) => r.rol_adi === 'Kalite Müdürü')} />}
      {lgm && <NobetDevirKarti />}
      {lgm && <OlayYoneticisiKarti />}
      {lgm && <><YukselenCagri /><CevrimDisiCakismalar /></>}
      {(() => { const acil = [...veri.onay, ...veri.islem, ...veri.gorev].filter((k) => k.oncelik === 'Kritik'); return acil.length > 0 && <>{/* YG-1635: acil kartlar Süre Uyarılarının üstünde */}
        <div className="bolum">Acil</div>
        {acil.map((k) => <div key={`acil-${k.kimlik}`} className="hata kart-sol"><KartUst k={k} /></div>)}</>; })()}
      <div className="bolum">Süre Uyarıları {lgm && <a className="btn2 kucuk" href="/api/takvim/gorevlerim.ics" download title="Süreli işlerinizi ve toplantılarınızı kişisel takviminize aktarır">Takvime Aktar</a>}</div>
      {veri.sureUyarilari.length === 0 ? <Bos m="Süresi yaklaşan işiniz bulunmamaktadır." /> : veri.sureUyarilari.map((k) => (
        <div key={k.kimlik} className="ozet kart-sol"><KartUst k={k} /></div>
      ))}

      {lgm && (<><div className="bolum">Planlanan Konumum · 7 Gün</div><KonumSeridi /></>)}

      <div className="bolum">Onayınızı Bekleyenler</div>
      {veri.onay.length === 0 ? <Bos m="Onayınızı bekleyen kayıt bulunmamaktadır." /> : veri.onay.map((k) => <OnayKarti key={k.kimlik} k={k} yenile={yenile} />)}

      <div className="bolum">İşleminizi Bekleyenler</div>
      {veri.islem.length === 0 ? <Bos m="İşleminizi bekleyen kayıt bulunmamaktadır." /> : veri.islem.map((k) => <IslemKarti key={k.kimlik} k={k} yenile={yenile} />)}

      <div className="bolum">İade Edilenler</div>{veri.iade.length === 0 && <Bos m="İade edilen kaydınız bulunmamaktadır." />}
      {veri.iade.length > 0 && (<>
        {veri.iade.map((k) => (
          <div key={k.kimlik} className="ozet kart-sol">
            <KartUst k={k} sayac={false} />
            {k.gerekce && <div className="uyari"><b>İade Gerekçesi:</b> {k.gerekce}</div>}
            <div className="dugmeler"><button className="btn" onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Yeniden Gönder' }).then(yenile)}>Yeniden Gönder</button><button className="btn2" onClick={() => void istek(`/is/${k.kimlik}/karar`, { karar: 'Geri Çek' }).then(yenile)}>Geri Çek</button></div>
          </div>
        ))}
      </>)}

      {veri.zincirde !== undefined && <><div className="bolum">Silsilenizde Bekleyenler</div>{veri.zincirde.length === 0 && <Bos m="Silsilenizde bekleyen kayıt bulunmamaktadır." />}</>}
      {(veri.zincirde ?? []).length > 0 && (<>
        {(veri.zincirde ?? []).map((k) => <KademeAtla key={k.kimlik} k={k} yenile={yenile} />)}
      </>)}
      <div className="bolum">Onaya Gönderilmiş İşlemlerim</div>{veri.gonderilmis.length === 0 && <Bos m="Onaya gönderilmiş işleminiz bulunmamaktadır." />}
      {veri.gonderilmis.length > 0 && (<>
        {veri.gonderilmis.map((k) => (
          <div key={k.kimlik} className="ozet kart-sol">
            <div className="ust2"><b>{k.baslik}</b><Rozet s="gri" c={`Kademe ${k.kademe + 1} / ${k.kademe_sayisi}`} /></div>
            <div className="not">{k.makam} Kontrolünde</div>
          </div>
        ))}
      </>)}

      <div className="bolum">Görevler ve Periyodik İşler</div>
      {veri.gorev.length === 0 ? <Bos m="Bugün için görev bulunmamaktadır." /> : veri.gorev.map((k) => <IslemKarti key={k.kimlik} k={k} yenile={yenile} />)}
      {ben.roller.some((r) => ['Operasyon Yöneticisi', 'Operasyon Müdürü', 'Operasyon Müdür Yardımcısı'].includes(r.rol_adi)) && <OperasyonPano />}
      {ben.roller.some((r) => ['Teknik Yönetici', 'Teknik Müdür', 'Teknik Müdür Yardımcısı'].includes(r.rol_adi)) && <TeknikPano />}
      {ben.roller.some((r) => r.rol_adi === 'Teknik Uzman') && <Raporlarim />}
      {ben.roller.some((r) => r.rol_adi === 'Kalite Uzmanı (Kalite Kontrolör)') && <KalitePano />}
      {ben.roller.some((r) => r.rol_adi === 'Kalite Uzmanı (Kalite Kontrolör)') && <KaliteTakvim />}
      {ben.roller.some((r) => ['Kalite Müdür Yardımcısı', 'Kalite Müdürü', 'Risk ve Kalite Direktörü'].includes(r.rol_adi)) && <KritikUygunsuzlukAcil rkd={ben.roller.some((r) => r.rol_adi === 'Risk ve Kalite Direktörü')} />}
      {ben.roller.some((r) => ['Kalite Müdür Yardımcısı', 'Kalite Müdürü'].includes(r.rol_adi)) && <EksikKalitePlanlari />}
      {ben.roller.some((r) => ['Kalite Müdür Yardımcısı', 'Kalite Müdürü', 'Kalite Yöneticisi'].includes(r.rol_adi)) && <KalibrasyonEnvanteri />}
      {ben.roller.some((r) => ['Tedarik Yöneticisi', 'Tedarik Müdür Yardımcısı', 'Tedarik Yönetimi Müdürü'].includes(r.rol_adi)) && <TedarikPano />}
      {ben.roller.some((r) => r.rol_adi === 'Tedarik Sorumlusu') && <TedarikSorumlusuPano />}
      {ben.roller.some((r) => ['Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü'].includes(r.rol_adi)) && <MaliErkenUyarilar />}
      {ben.roller.some((r) => ['Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdür Yardımcısı'].includes(r.rol_adi)) && <MasrafBelgeKontrol yenile={yenile} />}
      {ben.roller.some((r) => ['Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdürü', 'Ticari İşler Direktörü'].includes(r.rol_adi)) && <EkipSureleri />}
      {ben.roller.some((r) => ['Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Ticari İşler Direktörü', 'Muhasebe ve Finans Müdürü'].includes(r.rol_adi)) && <TahsilatIzleme />}
      {lgm && <HaftaVeGecmis veri={veri} />}
      {lgm && <><OzelGunler /><GozdenGecirmeler /><IsListeleri /><KonumPlani /><DosyaHaritasi /></>}
    </>
  );
}

/** YG-1590: Yeni Malzeme Talepleri, Tedarik Uyarıları ve Siparişlerim. */
function TedarikSorumlusuPano() {
  const [v, setV] = useState<{ talepler: { kimlik: string; kayit_no: string; dosya_no: string | null; oncelik: string }[]; siparisler: { kimlik: string; siparis_no: string; statu: string; tedarikci_kabul: string | null; teslim_tarihi: string; dosya_ref?: string | null; benim?: boolean; makam: string | null }[]; uyarilar: { siparis_no: string; tur: string }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/tedarik-sorumlusu-pano').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  return <>
    <div className="bolum">Yeni Malzeme Talepleri</div>
    {v.talepler.length === 0 ? <Bos m="Size atanmış yeni malzeme talebi bulunmamaktadır." /> : v.talepler.map((x) => <div key={x.kimlik} className={`ozet kart-sol${x.oncelik === 'Kritik' ? ' hata' : ''}`}><b>{x.kayit_no}{x.dosya_no ? ` · ${x.dosya_no}` : ''}</b><div className="not">{x.oncelik}</div><CikarCatismasi id={x.kimlik} /></div>)}
    <div className="bolum">Tedarik Uyarıları</div>
    {v.uyarilar.length === 0 ? <Bos m="Tedarik uyarısı bulunmamaktadır." /> : v.uyarilar.map((u, i) => <div key={i} className="ozet kart-sol"><b>{u.siparis_no}</b> · {u.tur}</div>)}
    <div className="bolum">Siparişlerim</div>
    {v.siparisler.length === 0 ? <Bos m="Açık siparişiniz bulunmamaktadır." /> : v.siparisler.map((s) => <div key={s.kimlik} className="ozet kart-sol"><b>{s.siparis_no}</b> · {s.makam ? `${s.makam} Kontrolünde` : s.statu}{s.tedarikci_kabul ? ` · Tedarikçi: ${s.tedarikci_kabul}` : ''} · Teslim: {s.teslim_tarihi.split('-').reverse().join('.')}{s.statu === 'Verildi' && !s.tedarikci_kabul && s.benim && s.dosya_ref && <SiparisIslakKabul kimlik={s.kimlik} dosya={s.dosya_ref} />}</div>)}
  </>;
}

/** YG-1592, YG-1593: Dağıtım Bekleyen Talepler (Tedarik Sorumlusu seçimi, Onayla / Gerekçeyle İade Et) ve Ekip Uyarıları. */
function TedarikPano() {
  const [v, setV] = useState<{ bekleyen: { kimlik: string; kayit_no: string; dosya_no: string | null; oncelik: string; son_zaman: string | null; cikar?: string | null }[]; uyarilar: { siparis_no: string; tur: string }[]; sorumlular: { kimlik: string; ad_soyad: string }[]; dagitir: boolean; supheli?: { kimlik: string; baslik: string; ozet: string | null }[] } | null>(null);
  const [sec, setSec] = useState<Record<string, string>>({}); const [iade, setIade] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/tedarik-pano').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (id: string, g: object, t: string) => void istek(`/tedarik/dagitim/${id}`, g).then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <>
    {(v.supheli?.length ?? 0) > 0 && <><div className="bolum">Acil</div>{/* YG-1594: şüpheli ürün */}
      {v.supheli!.map((x) => <div key={x.kimlik} className="ozet kart-sol hata"><div className="ust2"><b>{x.baslik}</b><Rozet s="kirmizi" c="Acil" /></div>{x.ozet && <div className="not">{x.ozet}</div>}
        <button className="btn hayir" onClick={() => void istek(`/malzeme-giris/${x.kimlik}/kullanimi-durdur`, {}).then(() => { setM('Ürünün kullanımı durduruldu ve karantinaya alındı.'); return yk(); }).catch((e) => setM(e.message))}>Kullanımı Durdur ve Karantinaya Al</button></div>)}</>}
    <div className="bolum">Dağıtım Bekleyen Talepler</div>{m && <div className="not" role="status">{m}</div>}
    {v.bekleyen.length === 0 ? <Bos m="Dağıtım bekleyen talep bulunmamaktadır." /> : v.bekleyen.map((x) => { const kl = x.son_zaman ? kalan(x.son_zaman) : null; return <div key={x.kimlik} className={`ozet kart-sol${x.oncelik === 'Kritik' ? ' hata' : ''}`}><div className="ust2"><b>{x.kayit_no}{x.dosya_no ? ` · ${x.dosya_no}` : ''}</b>{kl && <Rozet s={kl.sinif} y={kl.yanip} c={kl.yazi} />}</div><div className="not">{x.oncelik}{x.cikar ? ` · Çıkar çatışması → yeniden atama: ${x.cikar}` : ''}</div>
      {v.dagitir && <><label htmlFor={`td-${x.kimlik}`}>Tedarik Sorumlusu</label><select required id={`td-${x.kimlik}`} value={sec[x.kimlik] ?? ''} onChange={(e) => setSec({ ...sec, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{v.sorumlular.map((s) => <option key={s.kimlik} value={s.kimlik}>{s.ad_soyad}</option>)}</select>
        <label htmlFor={`ti-${x.kimlik}`}>İade Gerekçesi (teknik şart eksikse)</label><input id={`ti-${x.kimlik}`} value={iade[x.kimlik] ?? ''} onChange={(e) => setIade({ ...iade, [x.kimlik]: e.target.value })} />
        <div className="dugmeler"><button className="btn evet" disabled={!sec[x.kimlik]} onClick={() => is(x.kimlik, { sorumlu: sec[x.kimlik] }, 'Talep atandı.')}>Onayla</button><button className="btn hayir" disabled={!(iade[x.kimlik] ?? '').trim()} onClick={() => is(x.kimlik, { iadeGerekcesi: iade[x.kimlik] }, 'Talep iade edildi.')}>Gerekçeyle İade Et</button></div></>}</div>; })}
    {v.supheli && <GeriCagirma />}
    <div className="bolum">Ekip Uyarıları</div>
    {v.uyarilar.length === 0 ? <Bos m="Ekip uyarısı bulunmamaktadır." /> : v.uyarilar.map((u, i) => <div key={i} className="ozet kart-sol"><b>{u.siparis_no}</b> · {u.tur}</div>)}
  </>;
}

/** YG-1685: Kritik Uygunsuzluk acil kartı ve Kontrol Noktalarım (H Bekletme, W Tanıklık, R Belge İnceleme). */
function KalitePano() {
  const [v, setV] = useState<{ noktalar: { kimlik: string; kontrol_noktasi_no: string; nokta_turu: string; kalem: string | null; kontrol_ozelligi: string; planlanan_zaman: string; sonuc: string | null; is_emri_no: string; dosya_no: string; kabul_sinifi: string | null }[]; kritik: { kimlik: string; uygunsuzluk_no: string; dosya_no: string; gercek_durum: string }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/kalite-pano').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const kod: Record<string, string> = { 'Bekletme': 'H', 'Tanıklık': 'W', 'Belge İnceleme': 'R' };
  return <>
    {v.kritik.map((u) => <div key={u.kimlik} className="hata kart-sol"><div className="ust2"><b>Kritik Uygunsuzluk · Kontrol Noktası Açık Kalır</b><Rozet s="kirmizi" c="Acil" /></div><div className="not">{u.dosya_no} · {u.uygunsuzluk_no} · {u.gercek_durum}</div><div className="not">Karar seviyesi: Kalite Müdürü ve Teknik Müdür.</div></div>)}
    <div className="bolum">Kontrol Noktalarım</div>
    {v.noktalar.length === 0 ? <Bos m="Açık kontrol noktanız bulunmamaktadır." /> : v.noktalar.map((n) => { const kl = kalan(n.planlanan_zaman); return <div key={n.kimlik} className="ozet kart-sol"><div className="ust2"><b>{n.kontrol_noktasi_no} · {n.nokta_turu}{kod[n.nokta_turu] ? ` (${kod[n.nokta_turu]})` : ''}</b><Rozet s={kl.sinif} y={kl.yanip} c={kl.yazi} /></div><div className="not">{n.dosya_no} · {n.is_emri_no}{n.kalem ? ` · ${n.kalem}` : ''} · {n.kontrol_ozelligi}{n.kabul_sinifi ? ` · Kabul Sınıfı ${n.kabul_sinifi}` : ''}{n.sonuc ? ` · ${n.sonuc}` : ''}</div></div>; })}
  </>;
}

/** YG-1586, YG-1587: Gözetim Uyarıları ve Gözetim / Müdürlük Dosyaları (teknik rapor durumu). */
function TeknikPano() {
  const [v, setV] = useState<{ dosyalar: { kimlik: string; dosya_no: string; oncelik: string; statu: string; yat_adi: string; rapor: string | null; gozetim_notu: string | null }[]; uyarilar: { dosya: string; dosya_no: string; tur: string; ozet: string }[]; mudur: boolean; durdurulan?: { kimlik: string; dosya_no: string; yat_adi: string; neden: string | null }[]; kuyruk?: { kimlik: string; dosya_no: string; oncelik: string; yat_adi: string; son: string | null; eksik: string[] }[] } | null>(null); const [m, setM] = useState('');
  const [gn, setGn] = useState(0);
  useEffect(() => { void istek<NonNullable<typeof v>>('/teknik-pano').then(setV).catch(() => setV(null)); }, [gn]);
  if (!v) return null;
  return <>
    {(v.durdurulan ?? []).map((d) => <div key={d.kimlik} className="hata kart-sol"><div className="ust2"><b>Karar Seviyesi: Siz · {d.dosya_no} · {d.yat_adi}</b><Rozet s="kirmizi" c="Acil" /></div><div className="not">{d.neden ?? 'İş durduruldu'} · GMY ve CEO bilgilendirildi; güvenli koşul doğrulanmadan iş yeniden başlatılmaz.</div></div>)}
    {v.kuyruk && v.mudur && <><div className="bolum">Atama Bekleyenler</div>{v.kuyruk.length === 0 ? <Bos m="Teknik atama bekleyen dosya bulunmamaktadır." /> : v.kuyruk.map((k) => { const kl = k.son ? kalan(k.son) : null; return <div key={k.kimlik} className={`ozet kart-sol${k.oncelik === 'Kritik' ? ' hata' : ''}`}><div className="ust2"><b>{k.dosya_no} · {k.yat_adi}</b>{kl && <Rozet s={kl.sinif} y={kl.yanip} c={kl.yazi} />}</div><div className="not">{k.oncelik} · Atanacak: {k.eksik.join(', ')}</div></div>; })}</>}
    <div className="bolum">{v.mudur ? 'Müdürlük Uyarıları' : 'Gözetim Uyarıları'}</div>{m && <div className="not" role="status">{m}</div>}
    {v.uyarilar.length === 0 ? <Bos m="Gözetim uyarısı bulunmamaktadır." /> : v.uyarilar.map((u, i) => <div key={i} className="ozet kart-sol"><div className="ust2"><b>{u.dosya_no} · {u.tur}</b></div><div className="not">{u.ozet}</div>
      {!v.mudur && u.tur === 'Saha Sorumlusu Gerekiyor' && <button className="btn2 kucuk" onClick={() => void istek(`/dosya/${u.dosya}/saha-sorumlusu-bildir`, {}).then(() => setM('Teknik Müdüre bildirildi.')).catch((e) => setM(e.message))}>Teknik Müdüre Bildir</button>}</div>)}
    <div className="bolum">{v.mudur ? 'Müdürlük Dosyaları' : 'Gözetim Dosyaları'}</div>
    {v.dosyalar.length === 0 ? <Bos m="Gözetiminizde dosya bulunmamaktadır." /> : <div className="tablo"><table className="kartli"><thead><tr><th>Dosya</th><th>Yat</th><th>Öncelik</th><th>Teknik Rapor</th></tr></thead><tbody>{v.dosyalar.map((d) => <tr key={d.kimlik}><td data-ad="Dosya">{d.dosya_no}</td><td data-ad="Yat">{d.yat_adi}</td><td data-ad="Öncelik">{d.oncelik}</td><td data-ad="Teknik Rapor">{d.rapor ?? '—'}</td></tr>)}</tbody></table></div>}
    {!v.mudur && <GozetimNotu dosyalar={v.dosyalar} yenile={() => setGn(gn + 1)} />}
  </>;
}

/** YG-1582, YG-1586: haftalık gözetim notu; bu hafta not yazılmamış dosyalar sarı rozetle sayılır. */
function GozetimNotu({ dosyalar, yenile }: { dosyalar: { kimlik: string; dosya_no: string; gozetim_notu: string | null }[]; yenile: () => void }) {
  const [s, setS] = useState(''); const [n, setN] = useState(''); const [m, setM] = useState('');
  if (dosyalar.length === 0) return null;
  const bekleyen = dosyalar.filter((d) => !d.gozetim_notu).length;
  return <><div className="bolum">Haftalık Gözetim Notu {bekleyen > 0 && <Rozet s="sari" c={`${bekleyen} Dosyada Bekleniyor`} />}</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{dosyalar.map((d) => <div key={d.kimlik}>{d.dosya_no} · {d.gozetim_notu ?? 'Bu hafta not yazılmadı'}</div>)}
      <label htmlFor="gn-d">Dosya</label><select required id="gn-d" value={s} onChange={(e) => { setS(e.target.value); setN(dosyalar.find((d) => d.kimlik === e.target.value)?.gozetim_notu ?? ''); }}><option value="">Seçiniz</option>{dosyalar.map((d) => <option key={d.kimlik} value={d.kimlik}>{d.dosya_no}</option>)}</select>
      <label htmlFor="gn-n">Gözetim Notu</label><textarea required id="gn-n" value={n} onChange={(e) => setN(e.target.value)} />
      <button className="btn2 kucuk" disabled={!s || !n.trim()} onClick={() => void istek(`/dosya/${s}/gozetim-notu`, { notu: n }).then(() => { setM('Gözetim notu kaydedildi.'); setS(''); setN(''); yenile(); }).catch((e) => setM(e.message))}>Gözetim Notunu Kaydet</button></div></>;
}

/** YG-1582, YG-1583: Müdahale Gerekenler, Gözetim Dosyaları ve ekip kapasitesi (/25). */
function OperasyonPano() {
  const [v, setV] = useState<{ dosyalar: { kimlik: string; dosya_no: string; oncelik: string; statu: string; asama: string | null; yat_adi: string; dosya_sorumlusu: string | null; gozetim_notu: string | null }[]; mudur?: boolean; mudahale: { baslik: string; son_zaman: string | null; tur: string }[]; ekip: { ad: string; yuk: number; ust: number }[]; oneri: string | null; kuyruk?: { kimlik: string; dosya_no: string; oncelik: string; yat_adi: string; son: string | null; onerilen: string | null }[]; kapanis?: { kimlik: string; dosya_no: string; yat_adi: string; ozet_durumu: string | null; kosul_bitis: string | null; kalan_gun: number | null; acik: number | null }[] } | null>(null);
  const [gn, setGn] = useState(0);
  useEffect(() => { void istek<NonNullable<typeof v>>('/operasyon-pano').then(setV).catch(() => setV(null)); }, [gn]);
  if (!v) return null;
  return <>
    {v.kuyruk && <><div className="bolum">Atama Bekleyenler</div>{v.kuyruk.length === 0 ? <Bos m="Atama bekleyen dosya bulunmamaktadır." /> : v.kuyruk.map((k) => { const kl = k.son ? kalan(k.son) : null; return <div key={k.kimlik} className={`ozet kart-sol${k.oncelik === 'Kritik' ? ' hata' : ''}`}><div className="ust2"><b>{k.dosya_no} · {k.yat_adi}</b>{kl && <Rozet s={kl.sinif} y={kl.yanip} c={kl.yazi} />}</div><div className="not">{k.oncelik}{k.onerilen ? ` · Önerilen Dosya Sorumlusu: ${k.onerilen}` : ''}</div></div>; })}</>}
    {v.mudur && v.kapanis && <><div className="bolum">Kapanış Bekleyenler</div>{/* YG-1583 */}
      {v.kapanis.length === 0 ? <Bos m="Kapanış bekleyen dosya bulunmamaktadır." /> : v.kapanis.map((k) => <div key={k.kimlik} className={`ozet kart-sol${k.kalan_gun !== null && k.kalan_gun < 0 ? ' hata' : ''}`}><div className="ust2"><b>{k.dosya_no} · {k.yat_adi}</b>{k.ozet_durumu && <Rozet s={k.ozet_durumu === 'İade' ? 'kirmizi' : 'sari'} c={`Nihai Kapanış Özeti: ${k.ozet_durumu === 'Onayda' ? 'Onay Bekliyor' : 'İade Edildi'}`} />}</div>
        {k.kosul_bitis && <div className="not">Koşullu kabul · {k.acik} açık iş · Son: {k.kosul_bitis.split('-').reverse().join('.')}{k.kalan_gun !== null ? (k.kalan_gun < 0 ? ` · ${-k.kalan_gun} gün gecikti` : ` · ${k.kalan_gun} gün kaldı`) : ''}</div>}</div>)}</>}
    <div className="bolum">Müdahale Gerekenler</div>
    {v.mudahale.length === 0 ? <Bos m="Müdahale gerektiren konu bulunmamaktadır." /> : v.mudahale.map((x, i) => <div key={i} className="ozet kart-sol"><div className="ust2"><b>{x.baslik}</b><Rozet s="kirmizi" c={x.tur} /></div>{x.son_zaman && <div className="not">Son: {sonYazi(x.son_zaman)}</div>}</div>)}
    <div className="bolum">Gözetim Dosyaları</div>
    {v.dosyalar.length === 0 ? <Bos m="Gözetiminizde dosya bulunmamaktadır." /> : <div className="tablo"><table className="kartli"><thead><tr><th>Dosya</th><th>Yat</th><th>Öncelik</th><th>Durum</th><th>Dosya Sorumlusu</th></tr></thead><tbody>{v.dosyalar.map((d) => <tr key={d.kimlik}><td data-ad="Dosya">{d.dosya_no}</td><td data-ad="Yat">{d.yat_adi}</td><td data-ad="Öncelik">{d.oncelik}</td><td data-ad="Durum">{d.statu}{d.asama ? ` · ${d.asama}` : ''}</td><td data-ad="Dosya Sorumlusu">{d.dosya_sorumlusu ?? '—'}</td></tr>)}</tbody></table></div>}
    {!v.mudur && <GozetimNotu dosyalar={v.dosyalar} yenile={() => setGn(gn + 1)} />}
    <div className="bolum">Ekip · Kapasite</div>
    <div className="ozet">{v.ekip.map((e) => <div key={e.ad}>{e.ad} · {e.yuk.toLocaleString('tr-TR')} / {e.ust}{e.yuk >= e.ust ? <Rozet s="kirmizi" c="Kapasite Dolu" /> : e.yuk >= e.ust * 0.8 ? <Rozet s="sari" c="Kapasite %80" /> : ''}</div>)}{v.oneri && <div className="uyari">{v.oneri}</div>}</div>
    <KarneItirazlari />
  </>;
}

/** YG-1583: Ekip bölümünde karara bağlanacak personel karne itirazları (Kabul / Kısmi Kabul / Ret, gerekçeyle). */
function KarneItirazlari() {
  const [l, setL] = useState<{ kimlik: string; konu: string; donem: string; nihai_puan: string | null; ad_soyad: string }[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => void istek<typeof l>('/personel-karne/itiraz-bekleyen').then(setL).catch(() => setL([]));
  useEffect(yk, []);
  const karar = (id: string, k: string) => void istek(`/personel-karne/itiraz/${id}/karar`, { karar: k, gerekce: g[id] ?? '' }).then(() => { setM('Karar kaydedildi.'); yk(); }).catch((e) => setM((e as Error).message));
  return <><div className="bolum">Ekip · Karne İtirazları</div>{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <Bos m="Karara bağlanacak karne itirazı bulunmamaktadır." /> : l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.ad_soyad} · {x.donem}</b>{x.nihai_puan !== null && <Rozet s="sari" c={`Puan: ${x.nihai_puan}`} />}</div><div className="not">{x.konu}</div>
      <label htmlFor={`ki-${x.kimlik}`}>Gerekçe</label><input required id={`ki-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
      <div className="dugmeler">{['Kabul', 'Kısmi Kabul', 'Ret'].map((k) => <button key={k} className={k === 'Ret' ? 'btn hayir' : k === 'Kabul' ? 'btn evet' : 'btn2'} disabled={!(g[x.kimlik] ?? '').trim()} onClick={() => karar(x.kimlik, k)}>{k}</button>)}</div></div>)}</>;
}

/** YG-1592: atanan talepte çıkar çatışması bildirimi; talep Tedarik Yöneticisine yeniden atamaya döner. */
function CikarCatismasi({ id }: { id: string }) {
  const [ac, setAc] = useState(false); const [a, setA] = useState(''); const [m, setM] = useState('');
  if (m) return <div className="not" role="status">{m}</div>;
  if (!ac) return <button className="btn2 kucuk" onClick={() => setAc(true)}>Çıkar Çatışması Bildir</button>;
  return <div className="tam"><label htmlFor={`cc-${id}`}>Açıklama</label><input required id={`cc-${id}`} value={a} onChange={(e) => setA(e.target.value)} />
    <button className="btn2 kucuk" disabled={!a.trim()} onClick={() => void istek(`/tedarik/dagitim/${id}/cikar-catismasi`, { aciklama: a }).then(() => setM('Talep yeniden atama için Tedarik Yöneticisine döndü.')).catch((e) => setM(e.message))}>Bildir</button></div>;
}

/** YG-1593: geri çağırma taraması (Tedarik Yönetimi Müdürü ve Müdür Yardımcısı). */
function GeriCagirma() {
  const [f, setF] = useState({ parca: '', urun: '', lot: '' }); const [l, setL] = useState<{ kimlik: string; kayit_no: string; lot_no: string; kabul_karari: string | null; urun_tanimi: string; uretici_parca_no: string; siparis_no: string; dosya_no: string; dosya_durumu: string; tedarikci: string }[] | null>(null); const [h, setH] = useState('');
  const ara = () => { setH(''); void istek<NonNullable<typeof l>>(`/tedarik/geri-cagirma?${new URLSearchParams(f).toString()}`).then(setL).catch((e) => { setL(null); setH((e as Error).message); }); };
  return <details><summary>Geri Çağırma Taraması</summary>{h && <div className="hata" role="alert">{h}</div>}
    <label htmlFor="gc-p">Üretici Parça No</label><input id="gc-p" value={f.parca} onChange={(e) => setF({ ...f, parca: e.target.value })} />
    <label htmlFor="gc-u">Ürün Tanımı</label><input id="gc-u" value={f.urun} onChange={(e) => setF({ ...f, urun: e.target.value })} />
    <label htmlFor="gc-l">Lot No</label><input id="gc-l" value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} />
    <button className="btn2 kucuk" onClick={ara}>Tara</button>
    {l && (l.length === 0 ? <div className="ozet bos">Etkilenen kayıt bulunmamaktadır.</div> : <div className="tablo"><table className="kartli"><thead><tr><th>Dosya</th><th>Sipariş</th><th>Ürün</th><th>Lot</th><th>Giriş Kararı</th></tr></thead><tbody>{l.map((x) => <tr key={x.kimlik}><td data-ad="Dosya">{x.dosya_no} · {x.dosya_durumu}</td><td data-ad="Sipariş">{x.siparis_no} · {x.tedarikci}</td><td data-ad="Ürün">{x.urun_tanimi} · {x.uretici_parca_no}</td><td data-ad="Lot">{x.lot_no}</td><td data-ad="Giriş Kararı">{x.kabul_karari ?? 'Kontrol Bekliyor'}</td></tr>)}</tbody></table></div>)}
  </details>;
}

/** YG-1585: Raporlarım (Teknik Uzman). */
function Raporlarim() {
  const [l, setL] = useState<{ kimlik: string; rapor_no: string; rapor_turu: string; dosya_no: string; durum: string }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/raporlarim').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <><div className="bolum">Raporlarım</div>
    {l.length === 0 ? <Bos m="Kontrolde veya son 30 günde onaylanmış raporunuz bulunmamaktadır." /> : l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.rapor_no}</b><Rozet s={x.durum === 'Onaylandı' ? 'yesil' : x.durum === 'İade Edildi' ? 'kirmizi' : 'gri'} c={x.durum} /></div><div className="not">{x.rapor_turu} · {x.dosya_no}</div></div>)}</>;
}

/** YG-1691, YG-1693: açık Kritik uygunsuzluklar (Acil, sayaçsız; karar seviyesi Kalite Müdürü ve Teknik Müdür). */
function KritikUygunsuzlukAcil({ rkd = false }: { rkd?: boolean }) {
  const [l, setL] = useState<{ kimlik: string; uygunsuzluk_no: string; dosya_no: string; gercek_durum: string | null; statu: string; sinif: string; emniyet_isareti: boolean; direktor_sorumlu_birim?: string | null; direktor_hedef?: string | null }[]>([]);
  const [kr, setKr] = useState<Record<string, { birim: string; hedef: string; not: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/kalite/kritik-uygunsuzluklar').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  const direktor = rkd; // YG-1694: Kararı Kaydet yalnız Risk ve Kalite Direktörü
  if (!l.length) return null;
  return <><div className="bolum">Acil</div>{l.map((u) => <div key={u.kimlik} className="ozet kart-sol hata"><div className="ust2"><b>{u.sinif === 'Kritik' ? 'Kritik Uygunsuzluk' : `${u.sinif} Uygunsuzluk`}{u.emniyet_isareti ? ' · Emniyet İşaretli' : ''} · {u.dosya_no}</b><Rozet s="kirmizi" c="Acil" /></div><div className="not">{u.uygunsuzluk_no} · {u.statu}{u.gercek_durum ? ` · ${u.gercek_durum}` : ''}</div>{direktor && <div className="tam">{u.direktor_sorumlu_birim && <div className="not">Karar: {u.direktor_sorumlu_birim} · Hedef {u.direktor_hedef?.split('-').reverse().join('.')}</div>}<label htmlFor={`rk-b-${u.kimlik}`}>Sorumlu Birim</label><input id={`rk-b-${u.kimlik}`} value={kr[u.kimlik]?.birim ?? ''} onChange={(e) => setKr({ ...kr, [u.kimlik]: { ...(kr[u.kimlik] ?? { birim: '', hedef: '', not: '' }), birim: e.target.value } })} /><label htmlFor={`rk-h-${u.kimlik}`}>Hedef Tarih</label><input id={`rk-h-${u.kimlik}`} type="date" value={kr[u.kimlik]?.hedef ?? ''} onChange={(e) => setKr({ ...kr, [u.kimlik]: { ...(kr[u.kimlik] ?? { birim: '', hedef: '', not: '' }), hedef: e.target.value } })} /><label htmlFor={`rk-n-${u.kimlik}`}>Not</label><input id={`rk-n-${u.kimlik}`} value={kr[u.kimlik]?.not ?? ''} onChange={(e) => setKr({ ...kr, [u.kimlik]: { ...(kr[u.kimlik] ?? { birim: '', hedef: '', not: '' }), not: e.target.value } })} /><button className="btn2 kucuk" disabled={!kr[u.kimlik]?.birim?.trim() || !kr[u.kimlik]?.hedef} onClick={() => void istek(`/uygunsuzluk/${u.kimlik}/direktor-karar`, kr[u.kimlik]).then(() => { setM('Karar kaydedildi; Kalite Müdürü ve Teknik Müdür bilgilendirildi.'); return yk(); }).catch((e) => setM(e.message))}>Kararı Kaydet</button></div>}</div>)}{m && <div className="not" role="status">{m}</div>}</>;
}

/** YG-1690: iş emri açılan dosyada eksik kalite planı, kabul matrisi veya muayene ve test planı; "Eksikliği Bildir". */
function EksikKalitePlanlari() {
  const [l, setL] = useState<{ kimlik: string; dosya_no: string; yat_adi: string; plan_yok: boolean; matris_yok: boolean; itp_yok: boolean; bildirim: string | null }[] | null>(null); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof l>>('/kalite/eksik-planlar').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  return <><div className="bolum">Eksik Kalite Belgeleri</div>{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <Bos m="İş emri açılan dosyalarda eksik kalite belgesi bulunmamaktadır." /> : l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.dosya_no} · {x.yat_adi}</b>{x.bildirim && <Rozet s="gri" c={`Bildirildi ${new Date(x.bildirim).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}`} />}</div>
      <div className="not">Eksik: {[x.plan_yok && 'Kalite Planı', x.matris_yok && 'Kabul Matrisi', x.itp_yok && 'Muayene ve Test Planı'].filter(Boolean).join(', ')}</div>
      <button className="btn2 kucuk" onClick={() => void istek(`/dosya/${x.kimlik}/kalite-eksikligi-bildir`, {}).then(() => { setM('Eksiklik Teknik Uzman ve Teknik Yöneticiye bildirildi.'); return yk(); }).catch((e) => setM(e.message))}>Eksikliği Bildir</button></div>)}</>;
}

/** YG-1651: firma başvurusu ön incelemesinde birim görüşü (Teknik Müdürlük, İSG); "Görüşü Gönder". */
function BirimGorusleri() {
  const [l, setL] = useState<{ kimlik: string; birim: string; ticari_unvan: string; kayit_rolu: string; isteyen: string }[]>([]); const [s, setS] = useState<Record<string, { sonuc: string; not: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/firma-birim-gorusu/bekleyen').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Firma Başvurusu Görüş Talepleri</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => { const v = s[x.kimlik] ?? { sonuc: '', not: '' }; return <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.ticari_unvan}</b><Rozet s="gri" c={`${x.birim} · ${x.kayit_rolu}`} /></div><div className="not">Talep eden: {x.isteyen}</div>
      <label htmlFor={`bg-${x.kimlik}`}>Görüş</label><select required id={`bg-${x.kimlik}`} value={v.sonuc} onChange={(e) => setS({ ...s, [x.kimlik]: { ...v, sonuc: e.target.value } })}><option value="">Seçiniz</option><option>Uygun</option><option>Koşullu</option><option>Uygun Değil</option></select>
      <label htmlFor={`bn-${x.kimlik}`}>Gerekçe</label><input required id={`bn-${x.kimlik}`} value={v.not} onChange={(e) => setS({ ...s, [x.kimlik]: { ...v, not: e.target.value } })} />
      <button className="btn2 kucuk" disabled={!v.sonuc || (v.sonuc !== 'Uygun' && !v.not.trim())} onClick={() => void istek(`/firma-birim-gorusu/${x.kimlik}/gonder`, v).then(() => { setM('Görüş talep edene gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Görüşü Gönder</button></div>; })}</>;
}

/** YG-1697 (A51-S6): Yurt Dışı Uygunluk Kontrolü (24 saat); sonuç teklif gönderimini açar. */
function YurtDisiUygunluk() {
  const [l, setL] = useState<{ kimlik: string; dosya_no: string; konum: string; yat_adi: string; son_zaman: string | null }[]>([]); const [f, setF] = useState<Record<string, { liman: boolean; calisma: boolean; gumruk: boolean; aciklama: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/yurt-disi-uygunluk/bekleyen').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Yurt Dışı Uygunluk Kontrolü</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => { const v = f[x.kimlik] ?? { liman: false, calisma: false, gumruk: false, aciklama: '' }; const s = (p: Partial<typeof v>) => setF({ ...f, [x.kimlik]: { ...v, ...p } }); const gonder = (sonuc: string) => void istek(`/dosya/${x.kimlik}/yurt-disi-uygunluk`, { ...v, sonuc }).then(() => { setM(`${x.dosya_no}: ${sonuc} kaydedildi; Dosya Sorumlusu bilgilendirildi.`); return yk(); }).catch((e) => setM(e.message));
      return <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.dosya_no} · {x.yat_adi}</b>{x.son_zaman && <Rozet s="sari" c={`Son: ${new Date(x.son_zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })}`} />}</div><div className="not">{x.konum}</div>
        <label><input type="checkbox" checked={v.liman} onChange={(e) => s({ liman: e.target.checked })} /> Liman ve Marina İzni</label>
        <label><input type="checkbox" checked={v.calisma} onChange={(e) => s({ calisma: e.target.checked })} /> Çalışma ve Giriş İzni</label>
        <label><input type="checkbox" checked={v.gumruk} onChange={(e) => s({ gumruk: e.target.checked })} /> Gümrük ve Geçici Kabul</label>
        <label htmlFor={`yu-a-${x.kimlik}`}>Açıklama</label><input required id={`yu-a-${x.kimlik}`} value={v.aciklama} onChange={(e) => s({ aciklama: e.target.value })} />
        <div className="dugmeler"><button className="btn2 kucuk" disabled={!(v.liman && v.calisma && v.gumruk)} onClick={() => gonder('Uygun')}>Uygun</button><button className="btn2 kucuk" disabled={!v.aciklama.trim()} onClick={() => gonder('Uygun Değil')}>Uygun Değil</button></div></div>; })}</>;
}

/** YG-1584: Operasyon Müdürü müdürlük göstergeleri (Cilt I §9; yönetim panosundaki birim göstergeleri). */
function MudurlukGostergeleri() {
  const [l, setL] = useState<{ kod: string; ad: string; deger: number | null; birim: string; durum: string; renk: string | null }[]>([]);
  useEffect(() => { void istek<{ cilt1: typeof l }>('/yonetim-panosu').then((r) => setL(r.cilt1)).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Müdürlük Göstergeleri</div>{l.map((x) => <div key={x.kod} className={x.renk === 'kirmizi' ? 'soru hata' : 'soru'}><span>{x.ad}: {x.deger === null ? 'Veri yok' : `${String(x.deger).replace('.', ',')} ${x.birim}`} · {x.durum}</span></div>)}</>;
}

/** YG-1671: İç Denetçinin kanıt talepleri (yanıtlayan LGM personeli). */
function KanitTaleplerim() {
  const [l, setL] = useState<{ kimlik: string; konu: string; son_tarih: string; denetim_no: string }[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/ic-denetim-kanit-talebi/bana').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Kanıt Talepleri</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.denetim_no}</b><Rozet s="sari" c={`Son: ${x.son_tarih.split('-').reverse().join('.')}`} /></div><div className="not">{x.konu}</div>
      <label htmlFor={`kt-${x.kimlik}`}>Yanıtınız</label><textarea required id={`kt-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
      <button className="btn2 kucuk" disabled={!g[x.kimlik]?.trim()} onClick={() => void istek(`/ic-denetim-kanit-talebi/${x.kimlik}/yanit`, { yanit: g[x.kimlik] }).then(() => { setM('Yanıt İç Denetçiye iletildi.'); return yk(); }).catch((e) => setM(e.message))}>Yanıtla</button></div>)}</>;
}

/** YG-1671 (YG-808, ¶2218): atanmış örneklem dosyalarının incelemesi; FR-KLT-011 denetim bulguları alanı. */
function OrneklemIncelemelerim() {
  const [l, setL] = useState<{ donem: string; kimlik: string; dosya_no: string }[]>([]); const [f, setF] = useState<Record<string, Record<string, string>>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/ic-denetim/orneklemim').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Dosya Örneklemi İncelemelerim</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => { const v = f[x.kimlik] ?? {}; const s = (k: string, d: string) => setF({ ...f, [x.kimlik]: { ...v, [k]: d } }); const gonder = (sonuc: string) => void istek(`/ic-denetim/orneklem/${x.donem}/${x.kimlik}/inceleme`, { sonuc, ...v }).then(() => { setM(`${x.dosya_no}: ${sonuc} kaydedildi.`); return yk(); }).catch((e) => setM(e.message));
      return <div key={`${x.donem}-${x.kimlik}`} className="ozet kart-sol"><b>{x.donem} · {x.dosya_no}</b><div className="not">Kayıt geçerli sürüme, doğru iş paketine, yetkili kullanıcıya ve kaynak kanıta bağlı mı; sonradan tamamlanan kayıt işlem zamanından ayrılıyor mu.</div>
        <label htmlFor={`oi-s-${x.kimlik}`}>Bulgu Sınıfı</label><select required id={`oi-s-${x.kimlik}`} value={v.sinif ?? ''} onChange={(e) => s('sinif', e.target.value)}><option value="">Seçiniz</option>{['Gözlem', 'Minör', 'Majör', 'Kritik'].map((z) => <option key={z}>{z}</option>)}</select>
        <label htmlFor={`oi-k-${x.kimlik}`}>Kanıt</label><input required id={`oi-k-${x.kimlik}`} value={v.kanit ?? ''} onChange={(e) => s('kanit', e.target.value)} />
        <label htmlFor={`oi-r-${x.kimlik}`}>Sorumlu</label><input required id={`oi-r-${x.kimlik}`} value={v.sorumlu ?? ''} onChange={(e) => s('sorumlu', e.target.value)} />
        <label htmlFor={`oi-h-${x.kimlik}`}>Hedef Tarih</label><input required id={`oi-h-${x.kimlik}`} type="date" value={v.hedef ?? ''} onChange={(e) => s('hedef', e.target.value)} />
        <div className="dugmeler"><button className="btn2 kucuk" onClick={() => gonder('Uygun')}>Uygun</button><button className="btn2 kucuk" disabled={!v.sinif || !v.kanit?.trim() || !v.sorumlu?.trim() || !v.hedef} onClick={() => gonder('Bulgulu')}>Bulguyla Kaydet</button></div></div>; })}</>;
}

/** YG-1593: tedarik müdürlük göstergeleri (son 90 gün). */
function TedarikGostergeleri() {
  const [l, setL] = useState<{ ad: string; deger: number | null; pay: number; payda: number; hedef: string }[]>([]);
  useEffect(() => { void istek<typeof l>('/tedarik/mudurluk-gostergeleri').then(setL).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Müdürlük Göstergeleri (Son 90 Gün)</div>{l.map((x) => <div key={x.ad} className="soru"><span>{x.ad}: {x.deger === null ? 'Veri yok' : `%${String(x.deger).replace('.', ',')} (${x.pay}/${x.payda})`} · Hedef {x.hedef}</span></div>)}</>;
}

/** YG-1611: Kontrol Uyarıları ve Banka Eşleştirme (işlem bazında; hesap bakiyeleri YG-1080 gereği dört role kapalı). */
/** YG-1608, TZ-6: Kontrol Bekleyenler — sigorta onay tutarı onaylı teklifin KDV hariç toplamından farklıysa doğrulanır veya gerekçeyle iade edilir. */
function SigortaTutarKontrol() {
  type K = { kimlik: string; dosya_no: string; teklif_no: string; onaylanan_tutar_eur: string; teklif_kdv_haric_eur: string; onay_tarihi: string };
  const [l, setL] = useState<K[] | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<{ yetkili: boolean; kayitlar: K[] }>('/ticari/kontrol-bekleyenler').then((r) => setL(r.yetkili ? r.kayitlar : null)).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const karar = (id: string, k: string) => void istek(`/sigorta-onayi/${id}/tutar-kontrol`, { karar: k, gerekce: g[id] }).then(() => { setM(k === 'Doğrulandı' ? 'Tutar doğrulandı.' : 'Kayıt gerekçeyle iade edildi.'); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Kontrol Bekleyenler</div>{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <div className="ozet bos">Kontrol bekleyen kaydınız bulunmamaktadır.</div> : l.map((x) => <div key={x.kimlik} className="ozet kart-sol">
      <b>{x.dosya_no} · {x.teklif_no} · Sigorta Onay Tutarı</b>
      <div>Onay tutarı {eur(Number(x.onaylanan_tutar_eur))} · Onaylı teklif (KDV hariç) {eur(Number(x.teklif_kdv_haric_eur))} · Onay tarihi {tarih(x.onay_tarihi)}</div>
      <label htmlFor={`stk-${x.kimlik}`}>İade Gerekçesi (iade edilecekse)</label><input id={`stk-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
      <div className="dugmeler"><button className="btn evet" onClick={() => karar(x.kimlik, 'Doğrulandı')}>Doğrulandı</button><button className="btn hayir" disabled={!g[x.kimlik]?.trim()} onClick={() => karar(x.kimlik, 'Gerekçeyle İade Et')}>Gerekçeyle İade Et</button></div>
    </div>)}</>;
}

function MaliKontrol() {
  const [v, setV] = useState<{ eslesmeyen: { kimlik: string; tarih: string; yon: string; tutar_eur: string; aciklama: string }[]; kurUyusmazligi: { kimlik: string; belge_no: string; kur_tarihi: string; fatura_kuru: number; tcmb_kuru: number }[]; odemeListeleri?: { kimlik: string; liste_no: string }[] } | null>(null);
  const [ok, setOk] = useState<Record<string, { kalemler: { tur: string; belge: string; faturaNo: string | null; cari: string; vade: string; brut: number; mahsup: number; tutulan: number; net: number; uyarilar: string[] }[]; toplamNet: number }>>({});
  const [f, setF] = useState<Record<string, { t?: string; c?: string; n?: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/mali-kontrol').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const es = (id: string) => void istek(`/mali-kontrol/eslestir/${id}`, { cariTuru: f[id]?.t ?? 'Müşteri', cari: f[id]?.c, not: f[id]?.n }).then(() => { setM('Hareket eşleştirildi.'); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Kontrol Uyarıları</div>{m && <div className="not" role="status">{m}</div>}
    {v.eslesmeyen.length + v.kurUyusmazligi.length === 0 && <div className="ozet bos">Kontrol uyarısı bulunmamaktadır.</div>}
    {(v.odemeListeleri ?? []).map((x) => <div key={x.kimlik} className="ozet kart-sol"><b>Ödeme Listesi Ön Kontrolü · {x.liste_no}</b>{/* YG-1611 */}
      {!ok[x.kimlik] ? <div className="dugmeler"><button className="btn2 kucuk" onClick={() => void istek<(typeof ok)[string]>(`/odeme-listesi/${x.kimlik}/on-kontrol`).then((r) => setOk({ ...ok, [x.kimlik]: r })).catch((e) => setM(e.message))}>Kalemleri Göster</button></div>
        : <>{ok[x.kimlik]!.kalemler.map((k, n) => <div key={n} className={k.uyarilar.length ? 'uyari' : 'soru'}><span>{k.tur} · {k.belge} · Fatura {k.faturaNo ?? '—'} · {k.cari} · Vade {tarih(k.vade)} · Brüt {eur(k.brut)} · Mahsup {eur(k.mahsup)} · Tutulan {eur(k.tutulan)} · Net {eur(k.net)}{k.uyarilar.length ? ` · ${k.uyarilar.join(', ')}` : ''}</span></div>)}<div className="not">Toplam net: {eur(ok[x.kimlik]!.toplamNet)}</div></>}</div>)}
    {v.kurUyusmazligi.map((x) => <div key={x.kimlik} className="uyari">Kur uyuşmazlığı · {x.belge_no} · {tarih(x.kur_tarihi)} · Fatura kuru {String(x.fatura_kuru).replace('.', ',')} · TCMB {String(x.tcmb_kuru).replace('.', ',')}</div>)}
    {v.eslesmeyen.map((x) => <div key={x.kimlik} className="ozet kart-sol"><b>Eşleşmeyen banka hareketi · {tarih(x.tarih)} · {x.yon} · {String(x.tutar_eur).replace('.', ',')} EUR</b><div>{x.aciklama}</div>
      <label htmlFor={`mk-t-${x.kimlik}`}>Cari Türü</label><select id={`mk-t-${x.kimlik}`} value={f[x.kimlik]?.t ?? 'Müşteri'} onChange={(e) => setF({ ...f, [x.kimlik]: { ...f[x.kimlik], t: e.target.value } })}>{['Müşteri', 'Sigorta Şirketi', 'Çözüm Ortağı', 'Tedarikçi'].map((z) => <option key={z}>{z}</option>)}</select>
      <label htmlFor={`mk-c-${x.kimlik}`}>Cari Kaydı</label><input id={`mk-c-${x.kimlik}`} value={f[x.kimlik]?.c ?? ''} onChange={(e) => setF({ ...f, [x.kimlik]: { ...f[x.kimlik], c: e.target.value } })} />
      <label htmlFor={`mk-n-${x.kimlik}`}>Teyit Notu</label><input required id={`mk-n-${x.kimlik}`} value={f[x.kimlik]?.n ?? ''} onChange={(e) => setF({ ...f, [x.kimlik]: { ...f[x.kimlik], n: e.target.value } })} />
      <div className="dugmeler"><button className="btn2 kucuk" disabled={!f[x.kimlik]?.c?.trim() || !f[x.kimlik]?.n?.trim()} onClick={() => es(x.kimlik)}>Eşleştir</button></div></div>)}</>;
}

/** YG-1662: firma kabul kararı itirazları; Kabul / Kısmi Kabul / Ret. */
function KabulItirazlari() {
  const [l, setL] = useState<{ kimlik: string; karar_asamasi: string; gerekce: string; ticari_unvan: string; son_zaman: string | null }[]>([]); const [f, setF] = useState<Record<string, { g?: string; k?: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/kurum-kabul-itirazlari').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  const karar = (id: string, k: string) => void istek(`/kurum-kabul-itirazi/${id}/karar`, { karar: k, gerekce: f[id]?.g, kabulEdilen: f[id]?.k }).then(() => { setM(`İtiraz kararı kaydedildi: ${k}.`); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Kabul Kararı İtirazları</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><b>{x.ticari_unvan} · {x.karar_asamasi} kararına itiraz</b><div>{x.gerekce}</div>{x.son_zaman && <div className="not">Karar son tarihi: {tarih(x.son_zaman)}</div>}
      <label htmlFor={`ki-g-${x.kimlik}`}>Karar Gerekçesi</label><input required id={`ki-g-${x.kimlik}`} value={f[x.kimlik]?.g ?? ''} onChange={(e) => setF({ ...f, [x.kimlik]: { ...f[x.kimlik], g: e.target.value } })} />
      <label htmlFor={`ki-k-${x.kimlik}`}>Kabul Edilen Kısım (Kısmi Kabulde)</label><input id={`ki-k-${x.kimlik}`} value={f[x.kimlik]?.k ?? ''} onChange={(e) => setF({ ...f, [x.kimlik]: { ...f[x.kimlik], k: e.target.value } })} />
      <div className="dugmeler">{['Kabul', 'Kısmi Kabul', 'Ret'].map((k) => <button key={k} className="btn2 kucuk" disabled={!f[x.kimlik]?.g?.trim() || (k === 'Kısmi Kabul' && !f[x.kimlik]?.k?.trim())} onClick={() => karar(x.kimlik, k)}>{k}</button>)}</div></div>)}</>;
}

/** YG-1594: Kaynak ve Risk (K4 tek kaynak, ikinci kaynak planı, muadil liste Mart/Eylül gözden geçirmesi); YG-784 tedarikçi karnesi. */
function KaynakRisk({ mudur }: { mudur: boolean }) {
  type V = { tekKaynak: { parca: string; urun: string; tedarikci: string; siparis: number; muadil: number; plan: string | null }[]; muadil: { son: { donem: string; aciklama: string; yapan: string } | null; sonraki: string; buDonemBekliyor: boolean }; supheli: number; tedarikciler: { kimlik: string; unvan: string; siparis: number; zamanindaOrani: number | null; kabulOrani: number | null; puan: number | null; esik: number | null; esikAlti: boolean }[] };
  const [v, setV] = useState<V | null>(null); const [p, setP] = useState<Record<string, string>>({}); const [a, setA] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<V>('/tedarik/kaynak-risk').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const y = (x: number | null) => (x === null ? 'Veri yok' : `%${String(x).replace('.', ',')}`);
  const donem = (x: string) => x.split('-').reverse().join('.');
  const plan = (parca: string) => void istek('/tedarik/kaynak-risk/plan', { parca, plan: p[parca] }).then(() => { setM(`${parca} için ikinci kaynak planı kaydedildi.`); return yk(); }).catch((e) => setM(e.message));
  const gg = () => void istek('/tedarik/muadil-gozden-gecirme', { aciklama: a }).then(() => { setM('Muadil liste gözden geçirmesi kaydedildi.'); setA(''); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Kaynak ve Risk ({v.tekKaynak.filter((x) => !x.plan).length + v.tedarikciler.filter((x) => x.esikAlti).length + (v.muadil.buDonemBekliyor ? 1 : 0)})</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="bolum">K4 Tek Kaynak Bağımlılığı (Son 24 Ay)</div>
    {v.tekKaynak.length === 0 ? <Bos m="Tek tedarikçiden alınan K4 parça bulunmamaktadır." /> : v.tekKaynak.map((x) => <div key={x.parca} className={x.plan ? 'soru' : 'uyari kart-sol'}><span><b>{x.parca}</b> · {x.urun} · {x.tedarikci} · {x.siparis} sipariş · Onaylı muadil: {x.muadil}</span>
      {x.plan ? <div className="not">İkinci kaynak planı: {x.plan}</div> : <div className="tam"><label htmlFor={`ik-${x.parca}`}>İkinci Kaynak Planı</label><input id={`ik-${x.parca}`} value={p[x.parca] ?? ''} onChange={(e) => setP({ ...p, [x.parca]: e.target.value })} /><div className="dugmeler"><button className="btn2 kucuk" disabled={!p[x.parca]?.trim()} onClick={() => plan(x.parca)}>Kaydet</button></div></div>}</div>)}
    <div className="bolum">Muadil Liste Gözden Geçirmesi (Mart / Eylül)</div>
    <div className="soru"><span>Son gözden geçirme: {v.muadil.son ? `${donem(v.muadil.son.donem)} · ${v.muadil.son.yapan} · ${v.muadil.son.aciklama}` : 'Kayıt yok'} · Sonraki dönem: {donem(v.muadil.sonraki)}</span></div>
    {v.muadil.buDonemBekliyor && mudur && <div className="ozet kart-sol"><label htmlFor="mgg">Gözden Geçirme Sonucu</label><input required id="mgg" value={a} onChange={(e) => setA(e.target.value)} /><div className="dugmeler"><button className="btn2 kucuk" disabled={!a.trim()} onClick={gg}>Gözden Geçirildi Olarak Kaydet</button></div></div>}
    <div className="bolum">Tedarikçi Karnesi (Son 180 Gün)</div>
    {v.supheli > 0 && <div className="uyari">Açık şüpheli ürün bildirimi: {v.supheli}</div>}
    {v.tedarikciler.length === 0 ? <Bos m="Son 180 günde teslim tarihi gelen sipariş bulunmamaktadır." /> : v.tedarikciler.map((x) => <div key={x.kimlik} className={x.esikAlti ? 'uyari' : 'soru'}><span>{x.unvan} · {x.siparis} sipariş · Zamanında teslim {y(x.zamanindaOrani)} · Kabul {y(x.kabulOrani)} · Puan {x.puan === null ? 'Yetersiz veri (en az 3 sipariş)' : String(x.puan).replace('.', ',')}{x.esikAlti ? ` · Eşik (${x.esik}) altında` : ''}</span></div>)}
  </details>;
}

/** YG-1685: Kalite Uzmanı takvimi (7 gün) ve Garanti Yeniden Doğrulama. */
function KaliteTakvim() {
  const [v, setV] = useState<{ olaylar: { kimlik: string; no: string; tur: string; zaman: string; dosya_no: string | null }[]; garanti: { kimlik: string; kayit_no: string; dosya_no: string }[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/kalite/takvim').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const z = (x: string) => new Date(x).toLocaleString('tr-TR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  const dog = (id: string, sonuc: string) => void istek(`/garanti-sikayet/${id}/yeniden-dogrulama`, { sonuc, aciklama: g[id] }).then(() => { setM(`Garanti yeniden doğrulama: ${sonuc}.`); return yk(); }).catch((e) => setM(e.message));
  return <>{m && <div className="not" role="status">{m}</div>}
    {v.garanti.length > 0 && <><div className="bolum">Garanti Yeniden Doğrulama</div>{v.garanti.map((x) => <div key={x.kimlik} className="ozet kart-sol"><b>{x.kayit_no} · {x.dosya_no}</b><label htmlFor={`gd-${x.kimlik}`}>Açıklama</label><input required id={`gd-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} /><div className="dugmeler"><button className="btn2 kucuk" onClick={() => dog(x.kimlik, 'Doğrulandı')}>Doğrulandı</button><button className="btn2 kucuk" disabled={!g[x.kimlik]?.trim()} onClick={() => dog(x.kimlik, 'Doğrulanmadı')}>Doğrulanmadı</button></div></div>)}</>}
    <div className="bolum">Takvim · 7 Gün</div>{v.olaylar.length === 0 ? <Bos m="Önümüzdeki 7 günde kontrol noktası veya toplantı bulunmamaktadır." /> : v.olaylar.map((x) => <div key={x.kimlik} className="soru"><span>{z(x.zaman)} · {x.tur} · {x.no}{x.dosya_no ? ` · ${x.dosya_no}` : ''}</span></div>)}</>;
}

/** YG-1693: Olay İzleme · Günlük; Kalite Müdürünün kapsamlı kök neden önerisi; Risk ve Kalite Direktörünün yıllık Yönetim Gözden Geçirmesi. */
function OlayIzleme({ rkd, km }: { rkd: boolean; km: boolean }) {
  const [v, setV] = useState<{ uygunsuzluk: { kimlik: string; no: string; dosya_no: string; sinif: string; emniyet_isareti: boolean; statu: string }[]; durdurma: { kimlik: string; dosya_no: string; yat_adi: string; konum: string }[]; cevre: { kimlik: string; dosya_no: string; olay_turu: string }[] } | null>(null);
  const [f, setF] = useState<Record<string, string>>({}); const [se, setSe] = useState<Record<string, string[]>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/kalite/olay-izleme').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const SE = ['Firma', 'Yöntem', 'Malzeme', 'Eğitim', 'Prosedür', 'Kontrol Planı'];
  return <details><summary>Olay İzleme · Günlük ({v.uygunsuzluk.length + v.durdurma.length + v.cevre.length})</summary>{m && <div className="not" role="status">{m}</div>}
    {v.durdurma.map((x) => <div key={x.kimlik} className="hata kart-sol">Emniyet Olayı · İş Durduruldu · {x.dosya_no} · {x.yat_adi} · {x.konum}</div>)}
    {v.cevre.map((x) => <div key={x.kimlik} className="soru"><span>Çevresel Olay · {x.dosya_no} · {x.olay_turu}</span></div>)}
    {v.uygunsuzluk.map((x) => <div key={x.kimlik} className="soru"><span>{x.sinif}{x.emniyet_isareti ? ' · Emniyet İşaretli' : ''} · {x.no} · {x.dosya_no} · {x.statu}</span>
      {km && <div className="tam"><div className="not">Kapsamlı Kök Neden Önerisi (tekrarda veya etkisiz düzeltici faaliyette)</div>{SE.map((s) => <label key={s}><input type="checkbox" checked={(se[x.kimlik] ?? []).includes(s)} onChange={(e) => setSe({ ...se, [x.kimlik]: e.target.checked ? [...(se[x.kimlik] ?? []), s] : (se[x.kimlik] ?? []).filter((z) => z !== s) })} /> {s}</label>)}
        <label htmlFor={`kk-o-${x.kimlik}`}>Öneri</label><input id={`kk-o-${x.kimlik}`} value={f[`o${x.kimlik}`] ?? ''} onChange={(e) => setF({ ...f, [`o${x.kimlik}`]: e.target.value })} /><label htmlFor={`kk-b-${x.kimlik}`}>Sorumlu Birim</label><input id={`kk-b-${x.kimlik}`} value={f[`b${x.kimlik}`] ?? ''} onChange={(e) => setF({ ...f, [`b${x.kimlik}`]: e.target.value })} /><label htmlFor={`kk-h-${x.kimlik}`}>Hedef Tarih</label><input id={`kk-h-${x.kimlik}`} type="date" value={f[`h${x.kimlik}`] ?? ''} onChange={(e) => setF({ ...f, [`h${x.kimlik}`]: e.target.value })} />
        <button className="btn2 kucuk" onClick={() => void istek(`/uygunsuzluk/${x.kimlik}/kapsamli-kok-neden`, { sistemEtkisi: se[x.kimlik] ?? [], oneri: f[`o${x.kimlik}`], birim: f[`b${x.kimlik}`], hedef: f[`h${x.kimlik}`] }).then(() => setM('Öneri Risk ve Kalite Direktörü kararına gönderildi.')).catch((e) => setM(e.message))}>Onaya Gönder</button></div>}</div>)}
    {rkd && <><div className="bolum">Kalite ve İSG Yönetim Gözden Geçirmesi · Yıllık</div>
      <label htmlFor="ygg-y">Yıl</label><input id="ygg-y" inputMode="numeric" value={f.yil ?? String(new Date().getFullYear())} onChange={(e) => setF({ ...f, yil: e.target.value })} />
      <label htmlFor="ygg-g">Girdiler</label><textarea id="ygg-g" value={f.girdiler ?? ''} onChange={(e) => setF({ ...f, girdiler: e.target.value })} /><label htmlFor="ygg-k">Kararlar</label><textarea id="ygg-k" value={f.kararlar ?? ''} onChange={(e) => setF({ ...f, kararlar: e.target.value })} /><label htmlFor="ygg-e">Eylemler</label><textarea id="ygg-e" value={f.eylemler ?? ''} onChange={(e) => setF({ ...f, eylemler: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => void istek('/kalite/yonetim-gozden-gecirme', { yil: Number(f.yil ?? new Date().getFullYear()), girdiler: f.girdiler, kararlar: f.kararlar, eylemler: f.eylemler }).then(() => setM('Gözden geçirme kaydedildi.')).catch((e) => setM(e.message))}>Gözden Geçirmeyi Kaydet</button></>}</details>;
}

/** YG-1689: Kalite Verisi Doğrulama (tamlık, tutarlılık, tekillik); gri sonuçlarda "Tamamlatma İste". */
function KaliteVeriDogrulama() {
  const [l, setL] = useState<{ kimlik: string; boyut: string; no: string; dosya_no: string; sorun: string; sorumlu_adi: string | null; istendi: boolean }[]>([]); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/kalite/veri-dogrulama').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Kalite Verisi Doğrulama</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={`${x.boyut}-${x.kimlik}`} className="soru"><span>{x.boyut} · {x.no} · {x.dosya_no} · {x.sorun}{x.sorumlu_adi ? ` · ${x.sorumlu_adi}` : ''}</span>{x.istendi ? <Rozet s="gri" c="Tamamlatma İstendi" /> : x.sorumlu_adi && <button className="btn2 kucuk" onClick={() => void istek(`/kalite/veri-dogrulama/${x.kimlik}/tamamlatma-iste`, {}).then(() => { setM('Tamamlatma istendi.'); return yk(); }).catch((e) => setM(e.message))}>Tamamlatma İste</button>}</div>)}</>;
}

/** YG-1687: Kayıt Disiplini · Eksik Kontrol Kayıtları; kontrolörden "Düzeltme İste". */
function EksikKontrolKayitlari() {
  const [l, setL] = useState<{ kimlik: string; tur: string; no: string; dosya_no: string; eksik: string; kontrolor_adi: string | null; istendi: boolean }[]>([]); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/kalite/eksik-kontrol-kayitlari').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Eksik Kontrol Kayıtları</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.no} · {x.dosya_no}</b><Rozet s={x.istendi ? 'gri' : 'sari'} c={x.istendi ? 'Düzeltme İstendi' : x.tur} /></div><div className="not">{x.eksik} · Kontrolör: {x.kontrolor_adi ?? 'Atanmamış'}</div>
      {!x.istendi && x.kontrolor_adi && <button className="btn2 kucuk" onClick={() => void istek(`/kalite/eksik-kontrol-kaydi/${x.kimlik}/duzeltme-iste`, {}).then(() => { setM('Düzeltme kontrolörden istendi.'); return yk(); }).catch((e) => setM(e.message))}>Düzeltme İste</button>}</div>)}</>;
}

/** YG-1701 (A53-Z1): şikâyette Teknik Yöneticiden istenen teknik görüş; onay kademesi değildir, "Görüşü Gönder". */
function SikayetTeknikGorusleri() {
  const [l, setL] = useState<{ kimlik: string; soru: string; kayit_no: string; dosya_no: string; konu: string | null; isteyen: string }[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/sikayet-teknik-gorus/bekleyen').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Şikâyet Teknik Görüş Talepleri</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.kayit_no} · {x.dosya_no}</b><Rozet s="gri" c="Teknik Görüş" /></div><div className="not">{x.konu ? `${x.konu} · ` : ''}İstenen: {x.soru} · Talep eden: {x.isteyen}</div>
      <label htmlFor={`stg-${x.kimlik}`}>Görüşünüz</label><textarea required id={`stg-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
      <button className="btn2 kucuk" disabled={!g[x.kimlik]?.trim()} onClick={() => void istek(`/sikayet-teknik-gorus/${x.kimlik}/gonder`, { gorus: g[x.kimlik] }).then(() => { setM('Görüş şikâyet kaydına bağlandı ve talep edene gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Görüşü Gönder</button></div>)}</>;
}

/** YG-1670: İSG Sorumlusu "İşi Durdur": ciddi ve yakın tehlikede sahadaki aktif işi durdurur; yeniden başlatma izni Teknik Müdürde. */
function IsgIsiDurdur() {
  const [l, setL] = useState<{ kimlik: string; dosya_no: string; yat_adi: string; konum: string; aktif: number; firmalar: string | null }[]>([]); const [n, setN] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/isg/sahadaki-isler').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  return <><div className="bolum">İşi Durdur</div>{m && <div className="not" role="status">{m}</div>}{l.length === 0 && <Bos m="Sahada aktif iş bulunmamaktadır." />}
    {l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.dosya_no} · {x.yat_adi}</b><Rozet s="gri" c={`${x.aktif} aktif iş emri`} /></div><div className="not">{x.konum}{x.firmalar ? ` · ${x.firmalar}` : ''}</div>
      <label htmlFor={`isd-${x.kimlik}`}>Durdurma Nedeni (ciddi ve yakın tehlike)</label><input required id={`isd-${x.kimlik}`} value={n[x.kimlik] ?? ''} onChange={(e) => setN({ ...n, [x.kimlik]: e.target.value })} />
      <button className="btn hayir kucuk" disabled={!n[x.kimlik]?.trim()} onClick={() => void istek(`/dosya/${x.kimlik}/is-durdur`, { neden: n[x.kimlik] }).then(() => { setM(`${x.dosya_no}: iş durduruldu; ilgililere anlık bildirim gönderildi. Yeniden başlatma izni Teknik Müdürdedir.`); return yk(); }).catch((e) => setM(e.message))}>İşi Durdur</button></div>)}</>;
}

/** YG-1697: firma kararı için hukuki görüş; onay kademesi değildir, "Görüşü Gönder". */
function HukukGorusleri() {
  const [l, setL] = useState<{ kimlik: string; ticari_unvan: string; oneri: string; isteyen: string }[]>([]); const [s, setS] = useState<Record<string, { gorus: string; not: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/firma-hukuk-gorusu/bekleyen').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length && !m) return null;
  return <><div className="bolum">Hukuki Görüş Talepleri</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => { const v = s[x.kimlik] ?? { gorus: '', not: '' }; return <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.ticari_unvan}</b><Rozet s="gri" c={`Öneri: ${x.oneri}`} /></div><div className="not">Talep eden: {x.isteyen}</div>
      <label htmlFor={`hg-${x.kimlik}`}>Görüş</label><select required id={`hg-${x.kimlik}`} value={v.gorus} onChange={(e) => setS({ ...s, [x.kimlik]: { ...v, gorus: e.target.value } })}><option value="">Seçiniz</option><option>Uygun</option><option>Koşullu</option><option>Uygun Değil</option></select>
      <label htmlFor={`hn-${x.kimlik}`}>Gerekçe</label><input required id={`hn-${x.kimlik}`} value={v.not} onChange={(e) => setS({ ...s, [x.kimlik]: { ...v, not: e.target.value } })} />
      <button className="btn2 kucuk" disabled={!v.gorus || (v.gorus !== 'Uygun' && !v.not.trim())} onClick={() => void istek(`/firma-hukuk-gorusu/${x.kimlik}/gonder`, v).then(() => { setM('Görüş talep edene gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Görüşü Gönder</button></div>; })}</>;
}

/** YG-1648: Süresi Dolmuş Zorunlu Belge (Acil, aktif firmada). */
function SuresiDolmusBelgeler() {
  const [l, setL] = useState<{ kimlik: string; ticari_unvan: string; tur: string; gecerlilik_bitis: string; engelleyici: boolean }[]>([]);
  useEffect(() => { void istek<typeof l>('/sicil/suresi-dolmus-belgeler').then(setL).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Acil</div>{l.map((x) => <div key={x.kimlik} className="ozet kart-sol hata"><div className="ust2"><b>Süresi Dolmuş Zorunlu Belge · {x.ticari_unvan}</b><Rozet s="kirmizi" c="Acil" /></div>
    <div className="not">{x.tur} · Bitiş: {x.gecerlilik_bitis.split('-').reverse().join('.')}{x.engelleyici ? ' · Yeni iş emri verilmez, hakediş ödemesi bekletilir.' : ''}</div></div>)}</>;
}

/** YG-1648 (A36): Sicil Kalitesi — kayıt yıldönümü gözden geçirme paketi ve 12 aydır güncellenmeyen kayıtlar. */
function SicilKalitesi() {
  type P = { firma: string; ticari_unvan: string; sicil_no: string; son_zaman: string | null; gecerli_belge: number; dolan_belge: number; personel: number; tesis: number; ekipman: number; kullanilamaz_ekipman: number };
  const [v, setV] = useState<{ yildonumu: P[]; guncellenmeyen: { kimlik: string; ticari_unvan: string; sicil_no: string; guncelleme_zamani: string }[]; hazirlar: boolean } | null>(null);
  const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => void istek<NonNullable<typeof v>>('/sicil/kalite').then(setV).catch(() => setV(null));
  useEffect(yk, []);
  if (!v || (!v.yildonumu.length && !v.guncellenmeyen.length)) return null;
  return <details><summary>Sicil Kalitesi · {v.yildonumu.length} yıldönümü · {v.guncellenmeyen.length} güncellenmeyen kayıt</summary>{m && <div className="not" role="status">{m}</div>}
    {v.yildonumu.map((x) => <div key={x.firma} className="ozet kart-sol"><div className="ust2"><b>{x.sicil_no} · {x.ticari_unvan} · Kayıt Yıldönümü</b>{x.son_zaman && <span className="not">Son: {tarih(x.son_zaman)}</span>}</div>
      <div className="not">Belge: {x.gecerli_belge} geçerli, {x.dolan_belge} süresi dolmuş · Personel: {x.personel} · Tesis: {x.tesis} · Ekipman: {x.ekipman} ({x.kullanilamaz_ekipman} kullanılamaz)</div>
      {v.hazirlar && <><label htmlFor={`yd-${x.firma}`}>Gözden Geçirme Değerlendirmesi</label><textarea required id={`yd-${x.firma}`} rows={2} value={g[x.firma] ?? ''} onChange={(e) => setG({ ...g, [x.firma]: e.target.value })} />
        <div className="dugmeler"><button className="btn2 kucuk" disabled={!g[x.firma]?.trim()} onClick={() => void istek(`/sicil/yildonumu/${x.firma}/onaya-gonder`, { degerlendirme: g[x.firma] }).then(() => { setM('Paket Firma Yönetimi Yöneticisine gönderildi.'); yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></div></>}</div>)}
    {v.guncellenmeyen.length > 0 && <><div className="bolum">12 Aydır Güncellenmeyen Kayıtlar</div>{v.guncellenmeyen.map((x) => <div key={x.kimlik} className="not">{x.sicil_no} · {x.ticari_unvan} · Son güncelleme: {tarih(x.guncelleme_zamani)}</div>)}</>}
  </details>;
}

/** YG-1650 (A37): Dağıtım Bekleyen Başvurular ("Sicil Sorumlusuna Ata"), kabul sistemi aylık göstergeleri, yıllık iyileştirme önerisi. */
function KabulSistemi() {
  type G = { ay: string; basvuru: number; on_inceleme: number; karar: number; onayli: number; kosullu: number; reddedildi: number; ort_gun: string | null; sure_asimi: number };
  const [v, setV] = useState<{ dagitim: { kimlik: string; sicil_no: string; ticari_unvan: string; kayit_rolu: string; olusturma_zamani: string; basvuru_kanali: string | null; beyan_teyidi: string | null; mukerrer_karari: string | null }[]; sorumlular: { kimlik: string; ad_soyad: string }[]; gostergeler: G[]; yillik: { yil: string; son_zaman: string | null } | null; aylik: { ay: string; son_zaman: string | null } | null; atar: boolean; hazirlar: boolean } | null>(null);
  const [s, setS] = useState<Record<string, string>>({}); const [oneri, setOneri] = useState(''); const [ad, setAd] = useState(''); const [m, setM] = useState('');
  const yk = () => void istek<NonNullable<typeof v>>('/firma/kabul-sistemi').then(setV).catch(() => setV(null));
  useEffect(yk, []);
  if (!v) return null;
  return <details><summary>Kabul Sistemi · {v.dagitim.length} dağıtım bekleyen başvuru</summary>{m && <div className="not" role="status">{m}</div>}
    {v.dagitim.length > 0 && <><div className="bolum">Dağıtım Bekleyen Başvurular</div>{v.dagitim.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.sicil_no} · {x.ticari_unvan}</b><span className="not">{x.kayit_rolu} · {tarih(x.olusturma_zamani)}{x.basvuru_kanali ? ` · ${x.basvuru_kanali}` : ''}{x.beyan_teyidi ? ` · Beyan: ${x.beyan_teyidi}` : ''}{x.mukerrer_karari === 'Karar bekliyor' ? ' · Benzer kayıt: mükerrer kararı bekliyor' : ''}</span></div>
      {v.atar && <><label htmlFor={`da-${x.kimlik}`}>Sicil Sorumlusu</label><select required id={`da-${x.kimlik}`} value={s[x.kimlik] ?? ''} onChange={(e) => setS({ ...s, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{v.sorumlular.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select>
        <div className="dugmeler"><button className="btn2 kucuk" disabled={!s[x.kimlik]} onClick={() => void istek(`/firma/${x.kimlik}/sicil-ata`, { kullanici: s[x.kimlik] }).then(() => { setM('Başvuru Sicil Sorumlusuna atandı.'); yk(); }).catch((e) => setM(e.message))}>Sicil Sorumlusuna Ata</button></div></>}</div>)}</>}
    <div className="bolum">Aylık Göstergeler · Son 12 Ay</div>
    <div className="tablo"><table className="kartli"><thead><tr><th>Ay</th><th>Başvuru</th><th>Ön İnceleme</th><th>Karar</th><th>Onaylı</th><th>Koşullu Onaylı</th><th>Reddedildi</th><th>Ortalama Süre (Gün)</th><th>Süre Aşımı</th></tr></thead>
      <tbody>{v.gostergeler.map((x) => <tr key={x.ay}><td data-ad="Ay">{x.ay.split('-').reverse().join('.')}</td><td data-ad="Başvuru">{x.basvuru}</td><td data-ad="Ön İnceleme">{x.on_inceleme}</td><td data-ad="Karar">{x.karar}</td><td data-ad="Onaylı">{x.onayli}</td><td data-ad="Koşullu Onaylı">{x.kosullu}</td><td data-ad="Reddedildi">{x.reddedildi}</td><td data-ad="Ortalama Süre (Gün)">{x.ort_gun === null ? '---' : Number(x.ort_gun).toLocaleString('tr-TR')}</td><td data-ad="Süre Aşımı">{x.sure_asimi}</td></tr>)}</tbody></table></div>
    {v.aylik && v.hazirlar && <><div className="bolum">{v.aylik.ay.split('-').reverse().join('.')} · Aylık Kabul Göstergeleri{v.aylik.son_zaman ? ` · Son: ${tarih(v.aylik.son_zaman)}` : ''}</div>
      <label htmlFor="kabul-aylik">Değerlendirme</label><textarea required id="kabul-aylik" rows={2} value={ad} onChange={(e) => setAd(e.target.value)} />
      <div className="dugmeler"><button className="btn2 kucuk" disabled={!ad.trim()} onClick={() => void istek('/firma/kabul-gostergeleri/onaya-gonder', { degerlendirme: ad }).then(() => { setM('Göstergeler Firma Yönetimi Müdür Yardımcısına gönderildi.'); setAd(''); yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></div></>}
    {v.yillik && <><div className="bolum">{v.yillik.yil} · Yıllık İyileştirme Önerisi{v.yillik.son_zaman ? ` · Son: ${tarih(v.yillik.son_zaman)}` : ''}</div>
      {v.hazirlar ? <><label htmlFor="kabul-oneri">İyileştirme Önerisi</label><textarea required id="kabul-oneri" rows={3} value={oneri} onChange={(e) => setOneri(e.target.value)} />
        <div className="dugmeler"><button className="btn2 kucuk" disabled={!oneri.trim()} onClick={() => void istek('/firma/kabul-iyilestirme', { oneri }).then(() => { setM('Öneri Firma Yönetimi Müdür Yardımcısına gönderildi.'); setOneri(''); yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></div></>
        : <div className="not">Firma Yönetimi Yöneticisinin önerisi bekleniyor.</div>}</>}
  </details>;
}

/** YG-1654 (A38): Dönem Performans Kartları; risk derecesi yalnız öneri; üç dönem kademeli düşüşte öneri Firma Yönetimi Müdürüne. */
function DonemKartlari() {
  type K = { kimlik: string; sicil_no: string; ticari_unvan: string; risk_derecesi: string | null; kapasite_is: number | null; donem_sonu: string; donem_puani: string | null; agirlikli_ortalama: string | null; uygunsuzluk_kesintisi: string; kapanan_dosya_sayisi: number; yetersiz_veri: boolean; acik_emniyet_uygunsuzlugu: boolean; risk_derecesi_onerisi: string; acik_duzeltici: number; denetim: number; kademeli_dusus: boolean; son: string; oneri_bekliyor: boolean };
  type I = { kimlik: string; sicil_no: string; ticari_unvan: string; kabul_karar_zamani: string; gun: number; is_emri: number; tamamlanan: number; acik_uygunsuzluk: number };
  const [v, setV] = useState<{ kartlar: K[]; ilkDonem: I[]; donem: string | null; ozetBekliyor: boolean; kayit: { zaman: string; ad_soyad: string } | null; kaydeder: boolean; oneriVerir: boolean } | null>(null); const [g, setG] = useState<Record<string, { oneri: string; gerekce: string }>>({}); const [m, setM] = useState(''); const [oz, setOz] = useState('');
  const yk = () => void istek<NonNullable<typeof v>>('/firma/donem-kartlari').then(setV).catch(() => setV(null));
  useEffect(yk, []);
  if (!v || (!v.kartlar.length && !v.ilkDonem.length)) return null;
  const s = (x: string | null) => (x === null ? '---' : Number(x).toLocaleString('tr-TR', { maximumFractionDigits: 2 }));
  return <details><summary>Dönem Performans Kartları · {v.kartlar.length} firma{v.kartlar.some((x) => x.kademeli_dusus) ? ` · ${v.kartlar.filter((x) => x.kademeli_dusus).length} kademeli düşüş` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {v.kartlar.map((x) => { const f = g[x.kimlik] ?? { oneri: '', gerekce: '' }; return <div key={x.kimlik} className={x.acik_emniyet_uygunsuzlugu || x.kademeli_dusus ? 'ozet kart-sol hata' : 'ozet kart-sol'}>
      <div className="ust2"><b>{x.sicil_no} · {x.ticari_unvan}</b><span className="not">Dönem: {x.donem_sonu.split('-').reverse().join('.')} · Son: {tarih(x.son)}</span></div>
      <div className="not">Dönem Puanı: {x.yetersiz_veri ? 'Yetersiz Veri' : s(x.donem_puani)} · Dosya Performansı: {s(x.agirlikli_ortalama)} ({x.kapanan_dosya_sayisi} dosya) · Denetim: {x.denetim} · Açık Düzeltici Faaliyet: {x.acik_duzeltici} · Kapasite: {x.kapasite_is ?? '---'}{x.acik_emniyet_uygunsuzlugu ? ' · Açık emniyet riski' : ''} · Risk Derecesi Önerisi: {x.risk_derecesi_onerisi} (mevcut: {x.risk_derecesi ?? '---'})</div>
      {x.kademeli_dusus && <div className="not">Üç dönem kademeli düşüş{x.oneri_bekliyor ? ' · Öneri Firma Yönetimi Müdürü Kontrolünde' : ''}</div>}
      {x.kademeli_dusus && v.oneriVerir && !x.oneri_bekliyor && <><label htmlFor={`kd-o-${x.kimlik}`}>Öneri</label><select required id={`kd-o-${x.kimlik}`} value={f.oneri} onChange={(e) => setG({ ...g, [x.kimlik]: { ...f, oneri: e.target.value } })}><option value="">Seçiniz</option><option>Erken Denetim</option><option>Gelişim Görüşmesi</option></select>
        <label htmlFor={`kd-g-${x.kimlik}`}>Gerekçe</label><input required id={`kd-g-${x.kimlik}`} value={f.gerekce} onChange={(e) => setG({ ...g, [x.kimlik]: { ...f, gerekce: e.target.value } })} />
        <button className="btn2 kucuk" disabled={!f.oneri || !f.gerekce.trim()} onClick={() => void istek(`/firma/${x.kimlik}/kademeli-dusus-onerisi`, f).then(() => { setM('Öneri Firma Yönetimi Müdürüne gönderildi.'); yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></>}
    </div>; })}
    {v.donem && (v.kayit ? <div className="not">Dönem kartları kaydedildi: {v.kayit.ad_soyad} · {tarih(v.kayit.zaman)}</div>
      : v.kaydeder && <div className="dugmeler"><button className="btn2 kucuk" onClick={() => void istek('/firma/donem-kartlari/kaydet', { donem: v.donem }).then(() => { setM('Dönem kartları kaydedildi.'); yk(); }).catch((e) => setM(e.message))}>Dönem Kartlarını Kaydet</button></div>)}
    {v.donem && v.oneriVerir && <><div className="bolum">Üç Aylık Karne Özeti · {v.donem.split('-').reverse().join('.')}</div>
      {v.ozetBekliyor ? <div className="not">Özet Firma Yönetimi Müdürü Kontrolünde</div> : <><label htmlFor="karne-oz">Gözden Geçirme Değerlendirmesi</label><textarea required id="karne-oz" rows={2} value={oz} onChange={(e) => setOz(e.target.value)} />
        <div className="dugmeler"><button className="btn2 kucuk" disabled={!oz.trim()} onClick={() => void istek('/firma/karne-ozeti', { donem: v.donem, degerlendirme: oz }).then(() => { setM('Karne özeti Firma Yönetimi Müdürüne gönderildi.'); setOz(''); yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></div></>}</>}
    {v.ilkDonem.length > 0 && <><div className="bolum">İlk Dönem İzlemesi · Yeni Aktif Firmalar</div>{v.ilkDonem.map((x) => <div key={x.kimlik} className={x.acik_uygunsuzluk ? 'ozet kart-sol hata' : 'ozet kart-sol'}><div className="ust2"><b>{x.sicil_no} · {x.ticari_unvan}</b><span className="not">Kabul: {tarih(x.kabul_karar_zamani)} · {x.gun} gün</span></div>
      <div className="not">İş Emri: {x.is_emri} · Tamamlanan: {x.tamamlanan} · Açık Uygunsuzluk: {x.acik_uygunsuzluk}</div></div>)}</>}
  </details>;
}

/** YG-1654 (A38): Risk Esaslı Denetim Planı; ertelemede gerekçe ve yeni tarih; denetçi sonucu kaydeder. */
function FirmaDenetimPlani() {
  type P = { kimlik: string; tur: string; planlanan_tarih: string; durum: string; risk_gerekcesi: string; erteleme_sayisi: number; son_erteleme_gerekcesi: string | null; sonuc: string | null; sicil_no: string; ticari_unvan: string; denetci: string; benim: boolean };
  const [v, setV] = useState<{ planlar: P[]; riskli: { kimlik: string; sicil_no: string; ticari_unvan: string; neden: string }[]; turler: string[]; planlar_mi: boolean; program_mi: boolean } | null>(null);
  const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => void istek<NonNullable<typeof v>>('/firma-denetim-plani').then(setV).catch(() => setV(null));
  useEffect(yk, []);
  if (!v || (!v.planlar.length && !v.riskli.length)) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); setG({}); yk(); }).catch((e) => setM(e.message));
  return <details><summary>Risk Esaslı Denetim Planı · {v.planlar.filter((x) => x.durum === 'Planlandı').length} planlı{v.riskli.length ? ` · ${v.riskli.length} denetim önerilen firma` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {v.riskli.map((x) => <div key={x.kimlik} className="not">Denetim önerilen: {x.sicil_no} · {x.ticari_unvan} · {x.neden}</div>)}
    {v.planlar.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.sicil_no} · {x.ticari_unvan} · {x.tur}</b><span className="not">{x.planlanan_tarih.split('-').reverse().join('.')} · {x.durum}</span></div>
      <div className="not">Denetçi: {x.denetci} · {x.risk_gerekcesi}{x.erteleme_sayisi ? ` · ${x.erteleme_sayisi} kez ertelendi: ${x.son_erteleme_gerekcesi}` : ''}{x.sonuc ? ` · Sonuç: ${x.sonuc}` : ''}</div>
      {x.durum === 'Planlandı' && v.planlar_mi && <><label htmlFor={`fd-e-${x.kimlik}`}>Erteleme Gerekçesi</label><input id={`fd-e-${x.kimlik}`} value={g[`e${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`e${x.kimlik}`]: e.target.value })} />
        <label htmlFor={`fd-t-${x.kimlik}`}>Yeni Tarih</label><input id={`fd-t-${x.kimlik}`} type="date" value={g[`t${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`t${x.kimlik}`]: e.target.value })} />
        <button className="btn2 kucuk" disabled={!g[`e${x.kimlik}`]?.trim() || !g[`t${x.kimlik}`]} onClick={() => is(istek(`/firma-denetim/${x.kimlik}/ertele`, { gerekce: g[`e${x.kimlik}`], yeniTarih: g[`t${x.kimlik}`] }), 'Denetim ertelendi.')}>Ertele</button></>}
      {x.durum === 'Planlandı' && x.benim && <><label htmlFor={`fd-s-${x.kimlik}`}>Denetim Sonucu</label><input id={`fd-s-${x.kimlik}`} value={g[`s${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`s${x.kimlik}`]: e.target.value })} />
        <button className="btn2 kucuk" disabled={!g[`s${x.kimlik}`]?.trim()} onClick={() => is(istek(`/firma-denetim/${x.kimlik}/sonuc`, { sonuc: g[`s${x.kimlik}`] }), 'Denetim sonucu kaydedildi.')}>Sonucu Kaydet</button></>}
    </div>)}
    {v.program_mi && <><div className="bolum">Yıllık Firma Denetim Programı Taslağı</div>
      <label htmlFor="fdp-yil">Program Yılı</label><input required id="fdp-yil" inputMode="numeric" value={g.pyil ?? ''} onChange={(e) => setG({ ...g, pyil: e.target.value })} />
      <label htmlFor="fdp-a">Açıklama</label><textarea required id="fdp-a" rows={2} value={g.pa ?? ''} onChange={(e) => setG({ ...g, pa: e.target.value })} />
      <div className="dugmeler"><button className="btn2 kucuk" disabled={!g.pyil || !g.pa?.trim()} onClick={() => void istek<{ cakisma: string[] }>('/firma-denetim-programi', { yil: Number(g.pyil), aciklama: g.pa }).then((r) => { setM(`Program Firma Yönetimi Müdürüne gönderildi.${r.cakisma.length ? ` Çakışma: ${r.cakisma.join('; ')}` : ' İç Denetim ile çakışma yok.'}`); setG({}); yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></div></>}
  </details>;
}

/** YG-1654: Geçici Askıdaki Firmanın Açık Dosyaları (Acil, sayaçsız). */
function AskiAcikIsler() {
  const [l, setL] = useState<{ kimlik: string; ticari_unvan: string; is_emri_no: string; statu: string; dosya_no: string; oneri: string; dosya_sorumlusu: string | null }[]>([]);
  useEffect(() => { void istek<typeof l>('/aski/acik-isler').then(setL).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Acil</div>{[...new Set(l.map((x) => x.ticari_unvan))].map((f) => <div key={f} className="ozet kart-sol hata"><div className="ust2"><b>Geçici Askıdaki Firmanın Açık Dosyaları · {f}</b><Rozet s="kirmizi" c="Acil" /></div>
    {l.filter((x) => x.ticari_unvan === f).map((x) => <div key={x.kimlik} className="not">{x.dosya_no} · {x.is_emri_no} ({x.statu}) · Öneri: {x.oneri}{x.dosya_sorumlusu ? ` · Karar: ${x.dosya_sorumlusu}` : ''}</div>)}</div>)}</>;
}

/** YG-1691: Kalibrasyon Envanteri. */
function KalibrasyonEnvanteri() {
  const [l, setL] = useState<{ kimlik: string; ad: string; seri_no: string; gecerlilik_sonu: string; kalan_gun: number; kritik: boolean; ara_dogrulama_tarihi: string | null; durum: string; kalibrasyon_kurulusu: string | null }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/olcum-cihazi').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  const tr = (x: string) => x.split('-').reverse().join('.');
  const uyari = l.filter((x) => x.durum === 'Karantina' || x.kalan_gun <= 60).length;
  return <details><summary>Kalibrasyon Envanteri · {l.length} cihaz{uyari ? ` · ${uyari} uyarı` : ''}</summary>
    {l.length === 0 ? <div className="ozet bos">Kayıtlı ölçüm cihazı bulunmamaktadır.</div> : <div className="tablo"><table className="kartli"><thead><tr><th>Cihaz</th><th>Seri No</th><th>Geçerlilik Sonu</th><th>Durum</th><th>Ara Doğrulama</th></tr></thead>
      <tbody>{l.map((x) => <tr key={x.kimlik}><td data-ad="Cihaz">{x.ad}{x.kritik ? ' · Kritik' : ''}</td><td data-ad="Seri No">{x.seri_no}</td><td data-ad="Geçerlilik Sonu">{tr(x.gecerlilik_sonu)} {x.kalan_gun < 0 ? <Rozet s="kirmizi" c="Süresi Geçti" /> : x.kalan_gun <= 30 ? <Rozet s="kirmizi" c={`${x.kalan_gun} gün`} /> : x.kalan_gun <= 60 ? <Rozet s="sari" c={`${x.kalan_gun} gün`} /> : null}</td><td data-ad="Durum">{x.durum}</td><td data-ad="Ara Doğrulama">{x.kritik ? (x.ara_dogrulama_tarihi ? tr(x.ara_dogrulama_tarihi) : 'Kayıt yok') : '—'}</td></tr>)}</tbody></table></div>}
  </details>;
}

/** YG-1610: Masraf Belge Kontrolü; fiş ayrıntısı, "Uygundur" (sonraki makama) ve "Gerekçeyle İade Et". */
function MasrafBelgeKontrol({ yenile }: { yenile: () => void }) {
  type F = { kimlik: string; kademe: number; kademe_sayisi: number; personel: string; masraf_turu: string; fis_tarihi: string; tutar_tl: string; kur: string; odenecek_eur: string; belge_turu: string; belge_ozeti: string; gorsel_var: boolean; istisna_gerekcesi: string | null };
  const [l, setL] = useState<F[] | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<F[]>('/masraf/belge-kontrol').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const ver = (x: F, karar: string, gerekce?: string) => void istek(`/is/${x.kimlik}/karar`, { karar, gerekce }).then(() => { setM(karar === 'Gerekçeyle İade Et' ? 'Fiş gerekçeyle iade edildi.' : 'Fiş uygun bulundu.'); void yk(); yenile(); }).catch((e) => setM(e.message));
  return <details><summary>Masraf Belge Kontrolü{l.length ? ` · ${l.length}` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <div className="ozet bos">Belge kontrolü bekleyen masraf fişi bulunmamaktadır.</div> : l.map((x) => { const son = x.kademe === x.kademe_sayisi - 1; return <div key={x.kimlik} className="ozet kart-sol">
      <div className="ust2"><b>{x.personel} · {x.masraf_turu}</b><Rozet s={x.gorsel_var ? 'yesil' : 'sari'} c={x.gorsel_var ? 'Görsel Var' : 'Görsel Yok'} /></div>
      <div className="not">{x.fis_tarihi.split('-').reverse().join('.')} · {x.belge_turu} {x.belge_ozeti} · {Number(x.tutar_tl).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL (kur {x.kur}) · Ödenecek {Number(x.odenecek_eur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR{x.istisna_gerekcesi ? ` · İstisna: ${x.istisna_gerekcesi}` : ''}</div>
      <label htmlFor={`mb-${x.kimlik}`}>İade Gerekçesi</label><input id={`mb-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
      <div className="dugmeler"><button className="btn evet" onClick={() => ver(x, son ? 'Onayla' : 'Onaya Gönder')}>{son ? 'Onayla' : 'Uygundur'}</button><button className="btn hayir" disabled={!(g[x.kimlik] ?? '').trim()} onClick={() => ver(x, 'Gerekçeyle İade Et', g[x.kimlik])}>Gerekçeyle İade Et</button></div></div>; })}
  </details>;
}

/** YG-1613: Mali Erken Uyarılar (brüt katkı, bütçe aşımı, müşteri limiti, 15 günü geçen alacak). */
function MaliErkenUyarilar() {
  const [l, setL] = useState<{ tur: string; baslik: string; ozet: string | null }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/mali-erken-uyarilar').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <><div className="bolum">Mali Erken Uyarılar</div>
    {l.length === 0 ? <Bos m="Mali erken uyarı bulunmamaktadır." /> : l.map((x, i) => <div key={i} className="ozet kart-sol"><div className="ust2"><b>{x.baslik}</b><Rozet s="sari" c={x.tur} /></div>{x.ozet && <div className="not">{x.ozet}</div>}</div>)}</>;
}

/** YG-1610: ekibin proforma ve fatura bilgisi süreleri. */
function EkipSureleri() {
  const [l, setL] = useState<{ kimlik: string; baslik: string; son: string }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/muhasebe-ekip-sureleri').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <><div className="bolum">Ekip Süre Uyarıları</div>
    {l.length === 0 ? <Bos m="Ekip süre uyarısı bulunmamaktadır." /> : l.map((x) => { const kl = kalan(x.son); return <div key={`${x.kimlik}-${x.baslik}`} className="ozet kart-sol"><div className="ust2"><b>{x.baslik}</b><Rozet s={kl.sinif} y={kl.yanip} c={kl.yazi} /></div></div>; })}</>;
}

/** YG-546: 15. gün yazılı ihtarı; son ödeme tarihi ve gönderim kanalı Ticari İşler Direktörünce girilir, PDF yeni sekmede açılır. */
function IhtarUret({ fatura }: { fatura: string }) {
  const [son, setSon] = useState(''); const [kanal, setKanal] = useState('E-posta'); const [dil, setDil] = useState('tr'); const [m, setM] = useState('');
  const uret = async () => { setM(''); const r = await fetch(`/api/fatura/${fatura}/yazili-ihtar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yatonet': '1' }, credentials: 'same-origin', body: JSON.stringify({ son, kanal, dil }) });
    if (!r.ok) { setM(((await r.json().catch(() => ({}))) as { hata?: string }).hata ?? 'İhtar üretilemedi.'); return; } window.open(URL.createObjectURL(await r.blob()), '_blank'); setM('Yazılı ihtar üretildi ve kayda geçti.'); };
  return <details><summary>Yazılı İhtar Üret</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor={`ih-s-${fatura}`}>Son Ödeme Tarihi</label><input id={`ih-s-${fatura}`} type="date" value={son} onChange={(e) => setSon(e.target.value)} />
    <label htmlFor={`ih-k-${fatura}`}>Gönderim Kanalı</label><select id={`ih-k-${fatura}`} value={kanal} onChange={(e) => setKanal(e.target.value)}>{['E-posta', 'Posta', 'Noter', 'PDF (elden)'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor={`ih-d-${fatura}`}>Dil</label><select id={`ih-d-${fatura}`} value={dil} onChange={(e) => setDil(e.target.value)}><option value="tr">Türkçe</option><option value="en">İngilizce</option></select>
    <button className="btn2 kucuk" disabled={!son} onClick={() => void uret()}>İhtarı Üret</button></details>;
}

/** YG-1608: vadesi geçen faturalar (gecikme günü, son takip basamağı, yazılı ihtar zamanı). */
function TahsilatIzleme() {
  const [l, setL] = useState<{ kimlik: string; dosya_no: string; fatura_no: string; muhatap: string; vade: string; kalan: number; gecikme: number; basamak: string | null; ihtar: string | null }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/tahsilat-izleme').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <><div className="bolum">Tahsilat</div>
    {l.length === 0 ? <Bos m="Vadesi geçen faturanız bulunmamaktadır." /> : l.map((x) => <div key={x.kimlik} className={`ozet kart-sol${x.gecikme >= 30 ? ' hata' : ''}`}>
      <div className="ust2"><b>{x.dosya_no} · {x.fatura_no}</b><Rozet s={x.gecikme >= 15 ? 'kirmizi' : 'sari'} c={`${x.gecikme} Gün Gecikti`} /></div>
      <div className="not">{x.muhatap} · Vade: {x.vade.split('-').reverse().join('.')} · Kalan: {x.kalan.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR{x.basamak ? ` · Takip: ${x.basamak}` : ''}{x.ihtar ? ` · Yazılı İhtar: ${sonYazi(x.ihtar)}` : ''}</div>{x.gecikme >= 15 && x.muhatap !== 'Sigorta Şirketi' && <IhtarUret fatura={x.kimlik} />}</div>)}</>;
}

/** YG-1579, YG-1585: Planlı İşler, 7 günlük Takvim (Bugün, Yarın, tarih ve gün adı) ve Son 72 Saatte Tamamlananlar. */
function HaftaVeGecmis({ veri }: { veri: BugunVeri }) {
  const planli = [...veri.islem, ...veri.gorev].filter((k) => k.oncelik === 'Planlı');
  const gun = (z: string) => new Date(z).toLocaleDateString('sv-SE', { timeZone: TZ });
  const bugunG = gun(new Date().toISOString()); const yarinG = gun(new Date(Date.now() + 86_400_000).toISOString());
  const etiket = (g: string) => g === bugunG ? 'Bugün' : g === yarinG ? 'Yarın' : new Date(`${g}T12:00:00Z`).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'long', timeZone: 'UTC' });
  const gunler = [...new Set((veri.takvim ?? []).map((x) => gun(x.zaman)))];
  return <>
    <div className="bolum">Planlı İşler</div>
    {planli.length === 0 ? <Bos m="Planlı işiniz bulunmamaktadır." /> : planli.map((k) => <div key={`p-${k.kimlik}`} className="ozet kart-sol"><KartUst k={k} /></div>)}
    <div className="bolum">Takvim · 7 Gün</div>
    {gunler.length === 0 ? <Bos m="Önümüzdeki 7 gün için takvim kaydınız bulunmamaktadır." /> : gunler.map((g) => <div key={g} className="ozet kart-sol"><b>{etiket(g)}</b>
      {(veri.takvim ?? []).filter((x) => gun(x.zaman) === g).map((x, i) => <div key={i} className="not">{new Date(x.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })} · {x.tur} · {x.baslik}</div>)}</div>)}
    <div className="bolum">Son 72 Saatte Tamamlananlar</div>
    {(veri.tamamlanan ?? []).length === 0 ? <Bos m="Son 72 saatte tamamlanan işiniz bulunmamaktadır." /> : (veri.tamamlanan ?? []).map((k) => <div key={`t-${k.kimlik}`} className="ozet kart-sol"><div className="ust2"><b>{k.baslik}</b><Rozet s="gri" c={k.durum} /></div><div className="not">{k.tur} · {sonYazi(k.kapanma_zamani)}</div></div>)}
  </>;
}

interface Bildirim { kimlik: string; zaman: string; baslik: string; ozet: string | null; okunma_zamani: string | null; dosya_no?: string | null }

/** YG-1626: tarih-saatiyle, okunmamışlar önde. */
/** YG-1356: TCMB döviz satış kuru (bilgi amaçlı); kayıt yoksa tire. */
function KurSeridi() {
  const [l, setL] = useState<{ pb: string; kur: number; tarih: string }[]>([]);
  useEffect(() => { istek<{ pb: string; kur: number; tarih: string }[]>('/doviz-kurlari').then(setL).catch(() => setL([])); }, []);
  const k = (pb: string) => { const x = l.find((z) => z.pb === pb); return x ? x.kur.toLocaleString('tr-TR', { minimumFractionDigits: 4 }) : '—'; };
  return <div className="ozet kur" data-t="kur-seridi"><b>TCMB Döviz Satış Kuru · Bilgi Amaçlıdır</b><div>EUR {k('EUR')} · USD {k('USD')} · GBP {k('GBP')}</div>{l[0] && <div className="not">{l[0].tarih.split('-').reverse().join('.')}</div>}</div>;
}

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
          <div className="dugmeler">{b.dosya_no && <DosyaBag no={b.dosya_no} />}<button className="btn2 kucuk" onClick={() => void istek(`/bildirim/${b.kimlik}/gizle`, {}).then(() => { yenile(); return istek<Bildirim[]>('/bildirimler'); }).then(setL).catch((e) => setHata(e.message))}>Gizle</button></div>
        </div>
      ))}
    </>
  );
}
