import { DosyaBag } from './DosyaBag';
import { useEffect, useState } from 'react';
import { istek, type Ben } from './api';
import { DosyaHaritasi, IsListeleri, KonumPlani } from './IsGorunumu';
import { GozdenGecirmeler } from './YonetimTakip';
import { OzelGunler } from './OzelGunler';

export interface Kart {
  kimlik: string; tur: string; kategori: string; baslik: string; ozet: string | null; oncelik: string; son_zaman: string | null; olusturma_zamani?: string;
  kademe: number; kademe_sayisi: number; durum: string; makam?: string; sonraki_rol?: string | null; hazirlayan_adi?: string | null; gerekce?: string | null; vekaleten?: boolean; arz_notlari?: string | null;
}
export interface BugunVeri {
  zincirde?: (Kart & { makam?: string })[]; onay: Kart[]; islem: Kart[]; gorev: Kart[]; iade: Kart[]; gonderilmis: Kart[]; sureUyarilari: Kart[];
  duyurular: { kimlik: string; baslik: string; govde: string | null; zorunlu: boolean; tur?: string }[]; ozelGunler?: { ad: string; gun: string; tur: string }[]; olaganustu: string | null; okunmamisBildirim: number; okunmamisMesaj: number; toplantilar: { kimlik: string; tpl_kod: string; konu: string; baslangic: string }[]; baskanlik?: { kimlik: string; tpl_kod: string; konu: string; baslangic: string; kapanis_bekliyor: boolean; tutanak_var: boolean; katilimci: number }[]; tamamlanan?: { kimlik: string; tur: string; baslik: string; durum: string; kapanma_zamani: string }[]; takvim?: { zaman: string; baslik: string; tur: string }[]; vekaletler: { kimlik: string; bitis: string; asil: string; rol: string }[];
}

const TZ = 'Europe/Istanbul';
const sonYazi = (s: string) => new Date(s).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).replace(',', '');

/** YG-1635: 5 güne kadar saat, üzeri gün. Süresi geçen kırmızı; renk yanıp sönmez. */
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
      {sayac && k.son_zaman && <div className="not son">Son: {sonYazi(k.son_zaman)}</div>}
      {k.oncelik !== 'Normal' && <div><Rozet s={ONCELIK[k.oncelik] ?? 'gri'} c={k.oncelik} /></div>}
      {k.ozet && <div className="not">{k.ozet}</div>}
    </>
  );
}

/** YG-1592, YG-1593: sipariş onayında sistem kontrolleri ve tutara göre son onay makamı. */
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
      <div className="not">Kademe {k.kademe + 1} / {k.kademe_sayisi}{k.hazirlayan_adi ? ` · Hazırlayan: ${k.hazirlayan_adi}` : ''}</div>
      {k.arz_notlari && <div className="not">Önceki Kademe Notları: {k.arz_notlari}</div>}
      {k.tur === 'Tedarik Siparişi' && <SiparisKontrolleri id={k.kimlik} />}
      {hata && <div className="hata" role="alert">{hata}</div>}
      {kodIste && <><label htmlFor={`kd-${k.kimlik}`}>Doğrulama Kodu</label><input id={`kd-${k.kimlik}`} inputMode="numeric" autoComplete="one-time-code" value={kod} onChange={(e) => setKod(e.target.value)} /></>}
      {acik ? (
        <div className="gerekce">
          <label htmlFor={`g${k.kimlik}`}>{acik === 'iade' ? 'İade Gerekçesi' : 'Red Gerekçesi'}</label>
          <textarea id={`g${k.kimlik}`} rows={2} value={gerekce} onChange={(e) => setGerekce(e.target.value)} placeholder="[Gerekçe]" />
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
          {!son && <><label htmlFor={`an-${k.kimlik}`}>Not (İsteğe Bağlı)</label><input id={`an-${k.kimlik}`} value={gerekce} onChange={(e) => setGerekce(e.target.value)} /></>}
          <div className="dugmeler">
            {son ? <button className="btn evet" disabled={mesgul} onClick={() => void ver('Onayla')}>{teyit ? 'Teyit Et' : 'Onayla'}</button> : <button className="btn" disabled={mesgul} onClick={() => void ver('Onaya Gönder', gerekce.trim() || undefined)}>{k.tur === 'Masraf Fişi' ? 'Uygundur' : 'Onaya Gönder'}</button>}
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
/** YG-1631: 7 günlük planlanan konum; veri kişinin konum planından (görev, izin, saha) gelir. */
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
    <div className="not">Bilgilendiriniz: {x.bilgilendir.join(', ')}</div></div>)}</>;
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

      {lgm && <NobetDevirKarti />}
      {lgm && <OlayYoneticisiKarti />}
      {lgm && <YukselenCagri />}
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
      {ben.roller.some((r) => ['Kalite Müdür Yardımcısı', 'Kalite Müdürü'].includes(r.rol_adi)) && <EksikKalitePlanlari />}
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
  const [v, setV] = useState<{ talepler: { kimlik: string; kayit_no: string; dosya_no: string | null; oncelik: string }[]; siparisler: { kimlik: string; siparis_no: string; statu: string; tedarikci_kabul: string | null; teslim_tarihi: string; makam: string | null }[]; uyarilar: { siparis_no: string; tur: string }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/tedarik-sorumlusu-pano').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  return <>
    <div className="bolum">Yeni Malzeme Talepleri</div>
    {v.talepler.length === 0 ? <Bos m="Size atanmış yeni malzeme talebi bulunmamaktadır." /> : v.talepler.map((x) => <div key={x.kimlik} className={`ozet kart-sol${x.oncelik === 'Kritik' ? ' hata' : ''}`}><b>{x.kayit_no}{x.dosya_no ? ` · ${x.dosya_no}` : ''}</b><div className="not">{x.oncelik}</div><CikarCatismasi id={x.kimlik} /></div>)}
    <div className="bolum">Tedarik Uyarıları</div>
    {v.uyarilar.length === 0 ? <Bos m="Tedarik uyarısı bulunmamaktadır." /> : v.uyarilar.map((u, i) => <div key={i} className="ozet kart-sol"><b>{u.siparis_no}</b> · {u.tur}</div>)}
    <div className="bolum">Siparişlerim</div>
    {v.siparisler.length === 0 ? <Bos m="Açık siparişiniz bulunmamaktadır." /> : v.siparisler.map((s) => <div key={s.kimlik} className="ozet kart-sol"><b>{s.siparis_no}</b> · {s.makam ? `${s.makam} Kontrolünde` : s.statu}{s.tedarikci_kabul ? ` · Tedarikçi: ${s.tedarikci_kabul}` : ''} · Teslim: {s.teslim_tarihi.split('-').reverse().join('.')}</div>)}
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
      {v.dagitir && <><label htmlFor={`td-${x.kimlik}`}>Tedarik Sorumlusu</label><select id={`td-${x.kimlik}`} value={sec[x.kimlik] ?? ''} onChange={(e) => setSec({ ...sec, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{v.sorumlular.map((s) => <option key={s.kimlik} value={s.kimlik}>{s.ad_soyad}</option>)}</select>
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
      <label htmlFor="gn-d">Dosya</label><select id="gn-d" value={s} onChange={(e) => { setS(e.target.value); setN(dosyalar.find((d) => d.kimlik === e.target.value)?.gozetim_notu ?? ''); }}><option value="">Seçiniz</option>{dosyalar.map((d) => <option key={d.kimlik} value={d.kimlik}>{d.dosya_no}</option>)}</select>
      <label htmlFor="gn-n">Gözetim Notu</label><textarea id="gn-n" value={n} onChange={(e) => setN(e.target.value)} />
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
  </>;
}

/** YG-1592: atanan talepte çıkar çatışması bildirimi; talep Tedarik Yöneticisine yeniden atamaya döner. */
function CikarCatismasi({ id }: { id: string }) {
  const [ac, setAc] = useState(false); const [a, setA] = useState(''); const [m, setM] = useState('');
  if (m) return <div className="not" role="status">{m}</div>;
  if (!ac) return <button className="btn2 kucuk" onClick={() => setAc(true)}>Çıkar Çatışması Bildir</button>;
  return <div className="tam"><label htmlFor={`cc-${id}`}>Açıklama</label><input id={`cc-${id}`} value={a} onChange={(e) => setA(e.target.value)} />
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

/** YG-1608: vadesi geçen faturalar (gecikme günü, son takip basamağı, yazılı ihtar zamanı). */
function TahsilatIzleme() {
  const [l, setL] = useState<{ kimlik: string; dosya_no: string; fatura_no: string; muhatap: string; vade: string; kalan: number; gecikme: number; basamak: string | null; ihtar: string | null }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/tahsilat-izleme').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <><div className="bolum">Tahsilat</div>
    {l.length === 0 ? <Bos m="Vadesi geçen faturanız bulunmamaktadır." /> : l.map((x) => <div key={x.kimlik} className={`ozet kart-sol${x.gecikme >= 30 ? ' hata' : ''}`}>
      <div className="ust2"><b>{x.dosya_no} · {x.fatura_no}</b><Rozet s={x.gecikme >= 15 ? 'kirmizi' : 'sari'} c={`${x.gecikme} Gün Gecikti`} /></div>
      <div className="not">{x.muhatap} · Vade: {x.vade.split('-').reverse().join('.')} · Kalan: {x.kalan.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR{x.basamak ? ` · Takip: ${x.basamak}` : ''}{x.ihtar ? ` · Yazılı İhtar: ${sonYazi(x.ihtar)}` : ''}</div></div>)}</>;
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
