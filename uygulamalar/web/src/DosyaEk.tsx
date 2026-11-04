import { useEffect, useState, type ReactNode } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;
function useYap(yenile: () => unknown) {
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yap = async (f: () => Promise<any>, tamam?: string) => { setHata(''); setNot(''); try { const r = await f(); if (r?.uyari) setNot(r.uyari); else if (tamam) setNot(tamam); await yenile(); return r; } catch (x) { setHata((x as Error).message); } };
  const Mesaj = () => <>{hata && <div className="hata" role="alert">{hata}</div>}{not && <div className="not" role="status">{not}</div>}</>;
  return { yap, Mesaj };
}

type Yap = (f: () => Promise<unknown>, m?: string) => Promise<void>;
const sayi = (x: string) => Number(x.replace(',', '.'));
const gun = (x: string | null) => (x ? x.slice(0, 10).split('-').reverse().join('.') : '—');
interface TeklifOz { kimlik: string; teklif_no: string; surum_no: number; statu: string; karar: string | null; teklif_muhatabi: string }

/** İP-4 ve İP-6 dosya işlemleri: hasar no, koşul, kesin teslim, protokol, yurt dışı, kurtarma, acil temas. */
export function DosyaEkIslemler({ id, teklifler, sigortali, ticari, ds, firmalar }: { id: string; teklifler: TeklifOz[]; sigortali: boolean; ticari: boolean; ds: boolean; firmalar: { kurulus_ref: string; ticari_unvan: string }[] }) {
  const [kosul, setKosul] = useState<{ kimlik: string; eylem: string; son_tarih: string; gerceklesmezse: string; durum: string; sorumlu: string; kalan: number }[]>([]);
  const [deg, setDeg] = useState<{ degisiklik_no: string; tur: string; mevcut: string; onerilen: string; bedel_farki_eur: string; ek_sure_gun: number; kanal: string; sigorta_onayi: string; durum: string }[]>([]);
  const [kur, setKur] = useState<{ kimlik: string; hizmet_turu: string; acil: boolean; ticari_unvan: string; yat_sahibi_onay_zamani: string | null; firma_onay_zamani: string | null; koordinator_onay_zamani: string | null; baslama_zamani: string | null }[]>([]);
  const [tem, setTem] = useState<{ tur: string; ozet: string; zaman: string }[]>([]);
  const [ekip, setEkip] = useState<{ kullanici: string; ad_soyad: string; rol: string }[]>([]);
  useEffect(() => { void istek<{ ekip: typeof ekip }>(`/dosya/${id}`).then((r) => setEkip(r.ekip)).catch(() => {}); }, [id]);
  const yukle = () => Promise.all([istek<typeof kosul>(`/dosya/${id}/kosullar`).then(setKosul), istek<typeof deg>(`/dosya/${id}/degisiklikler`).then(setDeg), istek<typeof kur>(`/dosya/${id}/kurtarma`).then(setKur), istek<typeof tem>(`/acil/${id}/temas`).then(setTem)]);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => {}); }, [id]);
  const [hn, setHn] = useState(''); const [k, setK] = useState({ teklif: '', eylem: '', sorumlu: '', son: '', gerceklesmezse: '' }); const [kb, setKb] = useState(''); const [kg, setKg] = useState(''); const [kt, setKt] = useState({ tarih: '', bedel: '' });
  const [p, setP] = useState({ tur: 'Değişiklik', mevcut: '', onerilen: '', fark: '', toplam: '', sure: '', kanal: 'YATONET 360', sigorta: 'Gerekli Değil', starih: '' }); const [pb, setPb] = useState('');
  const [ku, setKu] = useState({ hizmet: 'Kurtarma', saglayici: '', acil: false }); const [dalis, setDalis] = useState({ limanIzni: '', dalisPlani: '', enerjiIzolasyonu: '' }); const [kod, setKod] = useState(''); const [te, setTe] = useState({ tur: '112 Arandı', ozet: '' }); const [sec, setSec] = useState('Devam');
  const ret = teklifler.filter((t) => t.teklif_muhatabi === 'Sigorta Şirketi' && t.karar === 'Ret');
  const kismi = teklifler.filter((t) => t.teklif_muhatabi === 'Sigorta Şirketi' && ['Kısmi Onay', 'Ret'].includes(t.karar ?? ''));
  return (
    <Blok baslik="Dosya İşlemleri"><Mesaj />
      {sigortali && <><label htmlFor="de-hn">Hasar Dosya No</label><input id="de-hn" value={hn} onChange={(e) => setHn(e.target.value)} /><button className="btn2 kucuk" disabled={!hn.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/hasar-no`, { no: hn }), 'Hasar dosya numarası kaydedildi.')}>Hasar No Kaydet</button></>}
      {ticari && kismi.map((t) => <div className="soru" key={t.kimlik}><span>{t.teklif_no}: Sigortaca onaylanmayan kalemler</span><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/onaylanmayan-teklif`, {}), 'Yat sahibine ayrı teklif taslağı açıldı.')}>Yat Sahibine Teklif Aç</button></div>)}
      {ds && ret.map((t) => <div className="soru" key={t.kimlik}><span>{t.teklif_no}: Yat Sahibinin Seçimi</span><div className="tam"><label htmlFor={`de-rs-${t.kimlik}`}>Seçim</label><select id={`de-rs-${t.kimlik}`} value={sec} onChange={(e) => setSec(e.target.value)}><option>Devam</option><option>Kapanış</option><option>Devir</option></select><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/ret-secenegi`, { secim: sec }), 'Seçim kaydedildi.')}>Seçimi Kaydet</button></div></div>)}

      <div className="bolum">Koşullu Onay</div>
      {kosul.map((x) => <div className="soru" key={x.kimlik}><span className={x.durum === 'Açık' ? 'uyari' : ''}>{x.eylem} · {x.sorumlu} · Son: {gun(x.son_tarih)}{x.durum === 'Açık' ? ` · Kalan: ${x.kalan} gün` : ''} · Gerçekleşmezse: {x.gerceklesmezse} · {x.durum}</span>
        {x.durum === 'Açık' && <div className="tam"><BelgeSec ad={`Koşul Kanıtı ${x.kimlik.slice(0, 6)}`} bagTuru="Dosya" bagKimligi={id} deger={kb} sec={setKb} /><button className="btn2 kucuk" disabled={!kb} onClick={() => void yap(() => istek(`/teklif-kosulu/${x.kimlik}/kapat`, { belge: kb }), 'Koşul kapatıldı.')}>Koşulu Kapat</button><label htmlFor={`de-rk-${x.kimlik}`}>Risk Kabulü Gerekçesi</label><input id={`de-rk-${x.kimlik}`} value={kg} onChange={(e) => setKg(e.target.value)} /><button className="btn2 kucuk" disabled={!kg.trim()} onClick={() => void yap(() => istek(`/teklif-kosulu/${x.kimlik}/risk-kabulu`, { gerekce: kg }), 'Risk kabulü onaya gönderildi.')}>Risk Kabulü İste</button></div>}
      </div>)}
      {teklifler.length > 0 && <>
        <label htmlFor="de-kt">Teklif</label><select id="de-kt" value={k.teklif} onChange={(e) => setK({ ...k, teklif: e.target.value })}><option value="">Seçiniz</option>{teklifler.map((t) => <option key={t.kimlik} value={t.kimlik}>{t.teklif_no} Rev.{t.surum_no}</option>)}</select>
        <label htmlFor="de-ke">Tamamlanacak Eylem</label><input id="de-ke" value={k.eylem} onChange={(e) => setK({ ...k, eylem: e.target.value })} />
        <label htmlFor="de-ks">Sorumlu</label><select id="de-ks" value={k.sorumlu} onChange={(e) => setK({ ...k, sorumlu: e.target.value })}><option value="">Seçiniz</option>{ekip.map((x) => <option key={x.kullanici} value={x.kullanici}>{x.ad_soyad} · {x.rol}</option>)}</select>
        <label htmlFor="de-kd">Koşul Son Tarihi</label><input id="de-kd" type="date" value={k.son} onChange={(e) => setK({ ...k, son: e.target.value })} />
        <label htmlFor="de-kg">Gerçekleşmezse Sonuç</label><input id="de-kg" value={k.gerceklesmezse} onChange={(e) => setK({ ...k, gerceklesmezse: e.target.value })} />
        <button className="btn2 kucuk" disabled={!k.teklif || !k.sorumlu || !k.eylem.trim() || !k.son || !k.gerceklesmezse.trim()} onClick={() => void yap(() => istek(`/teklif/${k.teklif}/kosul`, k), 'Koşul kaydedildi.')}>Koşul Ekle</button>
      </>}

      <div className="bolum">Kesin Teslim Tarihi</div>
      <div className="iki-tarih"><div><label htmlFor="de-kst">Kesin Teslim</label><input id="de-kst" type="date" value={kt.tarih} onChange={(e) => setKt({ ...kt, tarih: e.target.value })} /></div><div><label htmlFor="de-ksb">Gecikme Bedeli (EUR)</label><input id="de-ksb" inputMode="decimal" value={kt.bedel} onChange={(e) => setKt({ ...kt, bedel: e.target.value })} /></div></div>
      <div className="dugmeler"><button className="btn2 kucuk" disabled={!kt.tarih || !kt.bedel} onClick={() => void yap(() => istek(`/dosya/${id}/kesin-teslim`, { tarih: kt.tarih, gecikmeBedeli: sayi(kt.bedel) }), 'Kesin teslim tarihi Genel Müdür Yardımcısı onayına gönderildi.')}>Onaya Gönder</button><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/dosya/${id}/yurt-disi`, {}), 'Yurt dışı işaretlendi; teklif Genel Müdür Yardımcısı onayına gider.')}>Yurt Dışı Yat</button></div>

      <div className="bolum">Değişiklik Protokolü</div>
      {deg.map((x) => <div key={x.degisiklik_no}>{x.degisiklik_no} · {x.tur} · Eski: {x.mevcut} · Yeni: {x.onerilen} · Fark: {x.bedel_farki_eur} EUR · {x.ek_sure_gun} gün · {x.kanal} · Sigorta: {x.sigorta_onayi} · {x.durum}</div>)}
      <label htmlFor="de-pt">Değişiklik Türü</label><select id="de-pt" value={p.tur} onChange={(e) => setP({ ...p, tur: e.target.value })}>{['Değişiklik', 'İlave İş', 'Süre Uzatımı'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="de-pm">Mevcut Durum</label><input id="de-pm" value={p.mevcut} onChange={(e) => setP({ ...p, mevcut: e.target.value })} />
      <label htmlFor="de-po">Önerilen Durum</label><input id="de-po" value={p.onerilen} onChange={(e) => setP({ ...p, onerilen: e.target.value })} />
      <div className="iki-tarih"><div><label htmlFor="de-pf">Bedel Farkı (EUR)</label><input id="de-pf" inputMode="decimal" value={p.fark} onChange={(e) => setP({ ...p, fark: e.target.value })} /></div><div><label htmlFor="de-pn">Yeni Toplam (EUR)</label><input id="de-pn" inputMode="decimal" value={p.toplam} onChange={(e) => setP({ ...p, toplam: e.target.value })} /></div></div>
      <label htmlFor="de-ps">Ek Süre (Gün)</label><input id="de-ps" inputMode="numeric" value={p.sure} onChange={(e) => setP({ ...p, sure: e.target.value })} />
      <label htmlFor="de-pk">Protokol Onay Kanalı</label><select id="de-pk" value={p.kanal} onChange={(e) => setP({ ...p, kanal: e.target.value })}>{['YATONET 360', 'E-imza', 'Islak İmza'].map((x) => <option key={x}>{x}</option>)}</select>
      {p.kanal !== 'YATONET 360' && <BelgeSec ad="İmzalı Protokol" bagTuru="Dosya" bagKimligi={id} deger={pb} sec={setPb} />}
      <label htmlFor="de-pg">Sigorta Şirketi Onayı</label><select id="de-pg" value={p.sigorta} onChange={(e) => setP({ ...p, sigorta: e.target.value })}><option>Gerekli Değil</option><option>Alındı</option></select>
      {p.sigorta === 'Alındı' && <><label htmlFor="de-pd">Sigorta Onay Tarihi</label><input id="de-pd" type="date" value={p.starih} onChange={(e) => setP({ ...p, starih: e.target.value })} /></>}
      <button className="btn2 kucuk" disabled={!p.mevcut.trim() || !p.onerilen.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/degisiklik`, { tur: p.tur, mevcut: p.mevcut, onerilen: p.onerilen, bedelFarki: p.fark ? sayi(p.fark) : 0, yeniToplam: p.toplam ? sayi(p.toplam) : undefined, ekSure: Number(p.sure) || 0, kanal: p.kanal, belge: pb || undefined, sigortaOnayi: p.sigorta, sigortaTarih: p.starih || undefined }), 'Protokol kaydedildi.')}>Protokol Aç</button>

      <div className="bolum">Kurtarma, Çekme ve Dalgıçlık</div>
      {kur.map((x) => <div className="soru" key={x.kimlik}><span>{x.hizmet_turu}{x.acil ? ' · Acil' : ''} · {x.ticari_unvan} · Yat Sahibi: {x.yat_sahibi_onay_zamani ? 'Onaylı' : 'Bekleniyor'} · Firma: {x.firma_onay_zamani ? 'Onaylı' : 'Bekleniyor'} · Koordinatör: {x.koordinator_onay_zamani ? 'Onaylı' : 'Bekleniyor'}{x.baslama_zamani ? ' · Başladı' : ''}</span>
        {!x.baslama_zamani && <div className="tam">
          {!x.koordinator_onay_zamani && <><label htmlFor={`de-ko-${x.kimlik}`}>Koordinatör Onay Kodu</label><input id={`de-ko-${x.kimlik}`} inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} /><button className="btn2 kucuk" disabled={!kod} onClick={() => void yap(() => istek(`/kurtarma/${x.kimlik}/koordinator-onay`, { kod }), 'Koordinatör onayı kaydedildi.')}>Koordinatör Onayı</button></>}
          {['Dalgıçlık', 'Birden Fazla'].includes(x.hizmet_turu) && <><BelgeSec ad="Liman İzni" bagTuru="Dosya" bagKimligi={id} deger={dalis.limanIzni} sec={(v) => setDalis({ ...dalis, limanIzni: v })} /><BelgeSec ad="Dalış Planı" bagTuru="Dosya" bagKimligi={id} deger={dalis.dalisPlani} sec={(v) => setDalis({ ...dalis, dalisPlani: v })} /><BelgeSec ad="Enerji İzolasyonu" bagTuru="Dosya" bagKimligi={id} deger={dalis.enerjiIzolasyonu} sec={(v) => setDalis({ ...dalis, enerjiIzolasyonu: v })} /></>}
          <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/kurtarma/${x.kimlik}/baslat`, dalis), 'Operasyon başladı.')}>Operasyonu Başlat</button>
          <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/kurtarma/${x.kimlik}/saglayici-gorunur`, {}), 'Sağlayıcı yat sahibine gösterilecek.')}>Açıklama Onayı Var</button>
        </div>}
      </div>)}
      <label htmlFor="de-kh">Hizmet Türü</label><select id="de-kh" value={ku.hizmet} onChange={(e) => setKu({ ...ku, hizmet: e.target.value })}>{['Kurtarma', 'Çekme / Refakat', 'Dalgıçlık', 'Birden Fazla'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="de-kf">Sağlayıcı</label><select id="de-kf" value={ku.saglayici} onChange={(e) => setKu({ ...ku, saglayici: e.target.value })}><option value="">Seçiniz</option>{firmalar.map((f) => <option key={f.kurulus_ref} value={f.kurulus_ref}>{f.ticari_unvan}</option>)}</select>
      <label className="kutu"><input type="checkbox" checked={ku.acil} onChange={(e) => setKu({ ...ku, acil: e.target.checked })} /><span>Acil</span></label>
      <button className="btn2 kucuk" disabled={!ku.saglayici} onClick={() => void yap(() => istek(`/dosya/${id}/kurtarma`, ku), 'Kurtarma operasyonu açıldı; yat sahibi onayı gönderildi.')}>Operasyon Aç</button>

      <div className="bolum">Acil Temas Kaydı</div>
      {tem.map((x, n) => <div key={n}>{x.tur} · {x.ozet} · {new Date(x.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })}</div>)}
      <label htmlFor="de-tt">Muhatap</label><select id="de-tt" value={te.tur} onChange={(e) => setTe({ ...te, tur: e.target.value })}>{['112 Arandı', 'Marina Teması', 'Operasyon Müdürü Arandı', 'Refakatli Giriş', 'Sahil Güvenlik', 'Liman Başkanlığı', 'İl Çevre Müdürlüğü'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="de-to">Temas Özeti</label><input id="de-to" value={te.ozet} onChange={(e) => setTe({ ...te, ozet: e.target.value })} />
      <button className="btn2 kucuk" disabled={!te.ozet.trim()} onClick={() => void yap(() => istek(`/acil/${id}/temas`, te), 'Temas kaydedildi.')}>Temas Kaydet</button>
    </Blok>
  );
}

/** YG-456: Ticari İşler Direktörü mutabakat raporunu gönderir; ikili teyit sonrası itiraz süresi başlar. */
export function MutabakatRaporlari() {
  const [l, setL] = useState<{ kimlik: string; sigortaci_adi: string; donem: string; kesim_tarihi: string; itiraz_son: string | null; durum: string; satirlar: { kimlik: string; dosya_no: string; fatura_no: string; acik_bakiye: string; itiraz_edildi: boolean; mutabik: boolean }[] }[] | null>(null); const [not, setNot] = useState<Record<string, string>>({});
  const yukle = () => istek<NonNullable<typeof l>>('/mutabakat').then(setL).catch(() => setL(null));
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle(); }, []);
  if (!l) return null;
  return (
    <Blok baslik="Sigorta Mutabakat Raporları"><Mesaj />
      {l.length === 0 && <div className="not">Rapor bulunmamaktadır.</div>}
      {l.map((r) => <div className="soru" key={r.kimlik}><span><b className="koyu">{r.sigortaci_adi}</b> · {r.donem} · {r.durum}{r.itiraz_son ? ` · İtiraz Son: ${gun(r.itiraz_son)}` : ''}</span>
        <div className="tam">
          {r.satirlar.map((s) => <div key={s.kimlik}>{s.dosya_no} · {s.fatura_no} · Açık: {s.acik_bakiye} EUR{s.itiraz_edildi ? ' · İtiraz' : ''}{s.mutabik ? ' · Mutabık' : ''}{r.durum === 'Gönderildi' && !s.itiraz_edildi && <><label htmlFor={`mu-${s.kimlik}`}>İtiraz Notu</label><input id={`mu-${s.kimlik}`} value={not[s.kimlik] ?? ''} onChange={(e) => setNot({ ...not, [s.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!not[s.kimlik]?.trim()} onClick={() => void yap(() => istek(`/mutabakat-satiri/${s.kimlik}/itiraz`, { not: not[s.kimlik] }), 'İtiraz kaydedildi.')}>İtirazı Kaydet</button></>}</div>)}
          {r.durum === 'Hazır' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/mutabakat/${r.kimlik}/gonder`, {}), 'Rapor ikili teyide gönderildi.')}>Raporu Gönder</button>}
        </div>
      </div>)}
    </Blok>
  );
}

/** YG-210, YG-273: firma kurtarma onayı ve acil müsaitlik. */
export function FirmaAcilIslemleri({ yap }: { yap: Yap }) {
  const [l, setL] = useState<{ kimlik: string; hizmet_turu: string; acil: boolean; firma_onay_zamani: string | null; dosya_no: string }[]>([]); const [kod, setKod] = useState(''); const [m, setM] = useState({ musait: true, dk: '' });
  useEffect(() => { void istek<typeof l>('/firma-portal/kurtarma').then(setL).catch(() => {}); }, []);
  return (<>
    {l.filter((x) => !x.firma_onay_zamani).map((x) => <div className="ozet" key={x.kimlik}><div>{x.dosya_no} · {x.hizmet_turu}{x.acil ? ' · Acil' : ''} Sözleşmesi</div><label htmlFor={`fk-${x.kimlik}`}>Onay Kodu</label><input id={`fk-${x.kimlik}`} inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} /><button className="btn2" disabled={!kod} onClick={() => void yap(() => istek(`/firma-portal/kurtarma/${x.kimlik}/onay`, { kod }).then(() => istek<typeof l>('/firma-portal/kurtarma').then(setL)), 'Onayınız kaydedildi.')}>Sözleşmeyi Onayla</button></div>)}
    <div className="ozet"><label className="kutu"><input type="checkbox" checked={m.musait} onChange={(e) => setM({ ...m, musait: e.target.checked })} /><span>Acil Göreve Müsaitim</span></label><label htmlFor="fk-dk">Yanıt Süresi (Dakika)</label><input id="fk-dk" inputMode="numeric" value={m.dk} onChange={(e) => setM({ ...m, dk: e.target.value })} /><button className="btn2" disabled={!m.dk} onClick={() => void yap(() => istek('/firma-portal/acil-musaitlik', { musait: m.musait, yanitDk: Number(m.dk) }), 'Müsaitlik kaydedildi.')}>Müsaitliği Kaydet</button></div>
  </>);
}
