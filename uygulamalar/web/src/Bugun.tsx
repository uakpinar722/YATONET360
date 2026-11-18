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
  duyurular: { kimlik: string; baslik: string; govde: string | null; zorunlu: boolean; tur?: string }[]; ozelGunler?: { ad: string; gun: string; tur: string }[]; olaganustu: string | null; okunmamisBildirim: number; okunmamisMesaj: number; toplantilar: { kimlik: string; tpl_kod: string; konu: string; baslangic: string }[]; tamamlanan?: { kimlik: string; tur: string; baslik: string; durum: string; kapanma_zamani: string }[]; takvim?: { zaman: string; baslik: string; tur: string }[]; vekaletler: { kimlik: string; bitis: string; asil: string; rol: string }[];
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
            {son ? <button className="btn evet" disabled={mesgul} onClick={() => void ver('Onayla')}>{teyit ? 'Teyit Et' : 'Onayla'}</button> : <button className="btn" disabled={mesgul} onClick={() => void ver('Onaya Gönder', gerekce.trim() || undefined)}>Onaya Gönder</button>}
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
      {ben.roller.some((r) => ['Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Ticari İşler Direktörü', 'Muhasebe ve Finans Müdürü'].includes(r.rol_adi)) && <TahsilatIzleme />}
      {lgm && <HaftaVeGecmis veri={veri} />}
      {lgm && <><OzelGunler /><GozdenGecirmeler /><IsListeleri /><KonumPlani /><DosyaHaritasi /></>}
    </>
  );
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
