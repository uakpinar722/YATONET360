import { useEffect, useState } from 'react';
import { istek } from './api';

const BOS = { kural: '', kayitSarti: '', ucret: '', servis: '', kuralTeyit: '', travelLift: '', vinc: '', azamiBoy: '', karaPark: '', kapasiteTeyit: '', izinTuru: '', izinNo: '', izinGecerlilik: '', enlem: '', boylam: '' };
const yaz = (x: unknown) => (x === null || x === undefined ? '' : String(x));

/** YG-113, YG-114: bağlama noktası kuralları, kapasite ve işletme izni. */
export function TesisBilgi({ kimlik }: { kimlik: string }) {
  const [ac, setAc] = useState(false); const [f, setF] = useState(BOS); const [m, setM] = useState('');
  useEffect(() => { if (ac) void istek<Record<string, unknown>>(`/firma-tesis/${kimlik}/bilgi`).then((r) => setF({ kural: yaz(r.dis_firma_kurali), kayitSarti: yaz(r.kayit_sarti), ucret: yaz(r.giris_ucreti_eur), servis: yaz(r.servis_kurulus_ref), kuralTeyit: yaz(r.kural_teyit_tarihi), travelLift: yaz(r.travel_lift_ton), vinc: yaz(r.vinc_ton), azamiBoy: yaz(r.azami_boy_m), karaPark: yaz(r.kara_park_kapasitesi), kapasiteTeyit: yaz(r.kapasite_teyit_tarihi), izinTuru: yaz(r.izin_turu), izinNo: yaz(r.izin_no), izinGecerlilik: yaz(r.izin_gecerlilik), enlem: yaz(r.enlem), boylam: yaz(r.boylam) })).catch((e) => setM(e.message)); }, [ac, kimlik]);
  if (!ac) return <button className="btn2 kucuk" onClick={() => setAc(true)}>Kapasite ve Kurallar</button>;
  const A = (k: keyof typeof BOS, et: string, tip = 'text') => <><label htmlFor={`tb-${k}-${kimlik}`}>{et}</label><input id={`tb-${k}-${kimlik}`} type={tip} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <div className="tam">{m && <div className="not" role="status">{m}</div>}
    <label htmlFor={`tb-k-${kimlik}`}>Dış Firma Kuralı</label><select id={`tb-k-${kimlik}`} value={f.kural} onChange={(e) => setF({ ...f, kural: e.target.value })}><option value="">Seçiniz</option>{['Serbest', 'Kayıt Şartlı', 'Ücretli', 'Kısıtlı', 'Yasak'].map((x) => <option key={x}>{x}</option>)}</select>
    {f.kural === 'Kayıt Şartlı' && A('kayitSarti', 'Kayıt Şartı')}{f.kural === 'Ücretli' && A('ucret', 'Giriş Ücreti (EUR)')}
    {A('kuralTeyit', 'Kural Teyit Tarihi', 'date')}{A('travelLift', 'Travel Lift (Ton)')}{A('vinc', 'Vinç (Ton)')}{A('azamiBoy', 'Azami Yat Boyu (m)')}{A('karaPark', 'Kara Park Kapasitesi')}{A('kapasiteTeyit', 'Kapasite Teyit Tarihi', 'date')}{A('izinTuru', 'İşletme İzni / Turizm Belgesi Türü')}{A('izinNo', 'Belge No')}{A('izinGecerlilik', 'Belge Geçerlilik Tarihi', 'date')}{A('enlem', 'Enlem')}{A('boylam', 'Boylam')}
    <button className="btn2 kucuk" onClick={() => void istek(`/firma-tesis/${kimlik}/bilgi`, f).then(() => setM('Kaydedildi.')).catch((e) => setM(e.message))}>Kaydet</button></div>;
}

type T = { kimlik: string; tesis_kodu: string; ad: string; il: string | null; travel_lift_ton: string | null; vinc_ton: string | null; azami_boy_m: string; dis_firma_kurali: string | null; mesafeKm: number | null };
type V = { tonaj: number | null; boy: number | null; konumVar: boolean; eksikOlcu: boolean; kapasitesiGirilmemis: number; tesisler: T[] };

/** YG-115, YG-333: yatın tonaj ve boyuna uygun tesisler, en yakından. */
export function OnerilenTesisler({ dosya }: { dosya: string }) {
  const [v, setV] = useState<V | null>(null);
  useEffect(() => { void istek<V>(`/dosya/${dosya}/onerilen-tesisler`).then(setV).catch(() => setV(null)); }, [dosya]);
  if (!v) return null;
  return <><div className="bolum">Önerilen Tesisler</div><div className="ozet">
    {v.eksikOlcu && <div className="not">Yatın tonaj veya boy bilgisi eksik; öneri yalnız girilen ölçüye göre yapıldı.</div>}
    {!v.konumVar && <div className="not">Yatın koordinatı kayıtlı değil; sıralama il eşleşmesine göre yapıldı.</div>}
    {v.tesisler.length === 0 && <div className="not">Uygun tesis bulunmamaktadır.</div>}
    {v.tesisler.map((x) => <div key={x.kimlik}>{x.ad}{x.il ? ` · ${x.il}` : ''}{x.mesafeKm !== null ? ` · ${x.mesafeKm} km` : ''} · Lift/Vinç: {x.travel_lift_ton ?? '—'} / {x.vinc_ton ?? '—'} t · Azami Boy: {x.azami_boy_m} m{x.dis_firma_kurali ? ` · Dış Firma: ${x.dis_firma_kurali}` : ''}</div>)}
    {v.kapasitesiGirilmemis > 0 && <div className="not">Kapasitesi girilmemiş {v.kapasitesiGirilmemis} tesis listeye alınmadı.</div>}</div></>;
}
