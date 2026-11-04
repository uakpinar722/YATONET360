import { useEffect, useState } from 'react';
import { BelgeSec } from './Kalite';
import { istek, type Ben } from './api';

interface Firma { kimlik: string; sicil_no: string; ticari_unvan: string; kayit_rolu: string; kayit_asamasi: string; ag_statusu: string }

/** YG-344, YG-354, YG-928: firma sicili; IBAN karantinada başlar, geri arama ve iki onayla geçerli olur. */
export function FirmaSicil({ ben }: { ben: Ben }) {
  const [l, setL] = useState<Firma[]>([]); const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  const [yeni, setYeni] = useState({ unvan: '', rol: 'Çözüm Ortağı' }); const [secili, setSecili] = useState('');
  const [belge, setBelge] = useState({ tur: '', bitis: '' }); const [iban, setIban] = useState(''); const [gerekce, setGerekce] = useState(''); const [oneri, setOneri] = useState('Koşullu Onaylı');
  const yukle = () => istek<Firma[]>('/firma/sicil').then(setL);
  useEffect(() => { void yukle().catch((x) => setHata((x as Error).message)); }, []);
  const yap = async (f: () => Promise<unknown>, t: string) => { setHata(''); setNot(''); try { await f(); setNot(t); await yukle(); } catch (x) { setHata((x as Error).message); } };
  const onay = ben.izinler.includes('firma.onay');
  return (
    <>
      <h1>Firma Sicili</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}
      <div className="bolum">Yeni Kayıt</div>
      <div className="ozet">
        <label htmlFor="fs-u">Ticari Unvan</label><input id="fs-u" value={yeni.unvan} onChange={(e) => setYeni({ ...yeni, unvan: e.target.value })} />
        <label htmlFor="fs-r">Kayıt Rolü</label><select id="fs-r" value={yeni.rol} onChange={(e) => setYeni({ ...yeni, rol: e.target.value })}>{['Çözüm Ortağı', 'Tedarikçi', 'Tesis'].map((x) => <option key={x}>{x}</option>)}</select>
        <button className="btn2" onClick={() => void yap(() => istek('/firma', yeni), 'Kayıt açıldı.')}>Kayıt Aç</button>
      </div>
      <div className="bolum">Kayıtlar</div>
      {l.length === 0 && <div className="ozet bos">Kayıt bulunmamaktadır.</div>}
      {l.length > 0 && <div className="tablo"><table className="kartli"><thead><tr><th>Sicil No</th><th>Unvan</th><th>Rol</th><th>Durum</th><th /></tr></thead><tbody>{l.map((f) => <tr key={f.kimlik}><td data-ad="Sicil No">{f.sicil_no}</td><td data-ad="Unvan">{f.ticari_unvan}</td><td data-ad="Rol">{f.kayit_rolu}</td><td data-ad="Durum">{f.kayit_asamasi} · {f.ag_statusu}</td><td data-ad="İşlem"><button className="btn2 kucuk" onClick={() => setSecili(f.kimlik)}>Seç</button></td></tr>)}</tbody></table></div>}
      {secili && <>
        <div className="bolum">{l.find((f) => f.kimlik === secili)?.ticari_unvan}</div>
        <div className="ozet">
          <SicilKarne id={secili} onay={onay} gerekce={gerekce} yap={yap} />
          {onay && <>
            <label htmlFor="fs-g">Statü Gerekçesi</label><input id="fs-g" value={gerekce} onChange={(e) => setGerekce(e.target.value)} />
            <button className="btn2" disabled={!gerekce.trim()} onClick={() => void yap(() => istek(`/firma/${secili}/statu`, { asama: 'Onaylı', ag: 'Aktif', gerekce }), 'Firma onaylandı.')}>Onayla ve Aktif Yap</button>
            <label htmlFor="fs-o">Olumsuz Öneri</label><select id="fs-o" value={oneri} onChange={(e) => setOneri(e.target.value)}><option>Koşullu Onaylı</option><option>Reddedildi</option></select>
            <button className="btn2" onClick={() => void yap(() => istek(`/firma/${secili}/hukuk-gorusu`, { oneri }), 'Hukuk ve Uyum görüşü istendi.')}>Hukuk Görüşü İste</button>
            <button className="btn2" disabled={!gerekce.trim()} onClick={() => void yap(() => istek(`/firma/${secili}/statu`, { asama: oneri, gerekce }), 'Karar kaydedildi.')}>Öneriyi Karara Bağla</button>
          </>}
          <label htmlFor="fs-b">Belge Türü</label><input id="fs-b" value={belge.tur} onChange={(e) => setBelge({ ...belge, tur: e.target.value })} />
          <label htmlFor="fs-t">Geçerlilik Bitişi</label><input id="fs-t" type="date" value={belge.bitis} onChange={(e) => setBelge({ ...belge, bitis: e.target.value })} />
          <button className="btn2" onClick={() => void yap(() => istek(`/firma/${secili}/belge`, { tur: belge.tur, bitis: belge.bitis || undefined }), 'Belge kaydedildi.')}>Belge Kaydet</button>
          <label htmlFor="fs-i">IBAN</label><input id="fs-i" value={iban} onChange={(e) => setIban(e.target.value)} />
          <button className="btn2" onClick={() => void yap(() => istek(`/firma/${secili}/iban`, { iban }), 'IBAN karantinaya alındı; teyit bekliyor.')}>IBAN Ekle</button>
          <FirmaSozlesme id={secili} yap={yap} />
        </div>
      </>}
    </>
  );
}

/** YG-928: giren kişi teyit edemez; e-posta teyit sayılmaz. Yetkisiz kullanıcıya bölüm görünmez. */
const PARAMETRE: Record<string, string> = { kabul: 'Kalite: Kabul başlangıç puanı', kosullu_kabul: 'Kalite: Koşullu Kabul başlangıç puanı', ret: 'Kalite: Ret başlangıç puanı', ilk_sefer: 'Kalite: İlk seferde kabul edilmeme kesintisi', majoer: 'Kalite: Majör uygunsuzluk kesintisi', minoer: 'Kalite: Minör uygunsuzluk kesintisi', basarisiz_test: 'Kalite: Başarısız test kesintisi', garanti: 'Kalite: Garanti çağrısı kesintisi', tol_kritik: 'Süre: Kritik tolerans (%)', tol_yuksek: 'Süre: Yüksek tolerans (%)', tol_normal: 'Süre: Normal tolerans (%)', tol_planli: 'Süre: Planlı tolerans (%)', tol_belirsiz: 'Süre: Teşhisi belirsiz ek tolerans (%)', sure_asim: 'Süre: Aşım başına kesinti', maliyet_1: 'Maliyet: Birinci bant sınırı (%)', maliyet_1_puan: 'Maliyet: Birinci bant sonu puanı', maliyet_2: 'Maliyet: İkinci bant sınırı (%)', yanit_kritik: 'İletişim: Kritik yanıt hedefi (saat)', yanit_yuksek: 'İletişim: Yüksek yanıt hedefi (saat)', yanit_normal: 'İletişim: Normal yanıt hedefi (saat)', yanit_planli: 'İletişim: Planlı yanıt hedefi (saat)', isg: 'Uyum: İSG ihlali kesintisi', prosedur: 'Uyum: Prosedür sapması kesintisi', denetim_majoer: 'Uyum: Denetim Majör bulgu kesintisi', denetim_minoer: 'Uyum: Denetim Minör bulgu kesintisi', eksik_belge: 'Uyum: Eksik belge kesintisi', kesinti_kritik: 'Dönem: Kritik uygunsuzluk kesintisi', kesinti_emniyet: 'Dönem: Emniyet işaretli uygunsuzluk kesintisi', agirlik_kritik: 'Dönem: Kritik ağırlığı', agirlik_yuksek: 'Dönem: Yüksek ağırlığı', agirlik_normal: 'Dönem: Normal ağırlığı', agirlik_planli: 'Dönem: Planlı ağırlığı', esik_tercihli: 'Risk: Tercihli eşiği', esik_standart: 'Risk: Standart eşiği', asgari_dosya: 'Dönem: Asgari dosya sayısı' };
/** YG-795: T&O Direktörü önerir, GMY görüşü ve CEO onayıyla ertesi gün yürürlüğe girer; geçmiş puanlar yeniden hesaplanmaz. */
export function KarneParametreleri() {
  const [v, setV] = useState<{ yururlukte: { surum: number; deger: Record<string, number> }; onayda: { surum: number } | null } | null>(null); const [d, setD] = useState<Record<string, string>>({}); const [ger, setGer] = useState(''); const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  const yukle = () => istek<NonNullable<typeof v>>('/karne-parametre').then((r) => { setV(r); setD(Object.fromEntries(Object.entries(r.yururlukte.deger).map(([k, x]) => [k, String(x)]))); }).catch((x) => setHata((x as Error).message));
  useEffect(() => { void yukle(); }, []);
  return (
    <>
      <h1>Karne Parametreleri</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}
      {v && <div className="ozet">
        <div>Yürürlükteki Sürüm: {v.yururlukte.surum}{v.onayda ? ` · Onayda: Sürüm ${v.onayda.surum}` : ''}</div>
        {Object.keys(v.yururlukte.deger).map((k) => <div key={k}><label htmlFor={`kp-${k}`}>{PARAMETRE[k] ?? k}</label><input id={`kp-${k}`} inputMode="decimal" value={d[k] ?? ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></div>)}
        <label htmlFor="kp-g">Gerekçe</label><input id="kp-g" value={ger} onChange={(e) => setGer(e.target.value)} />
        <button className="btn2" disabled={!ger.trim() || Boolean(v.onayda)} onClick={() => { setHata(''); setNot(''); void istek('/karne-parametre', { gerekce: ger, deger: Object.fromEntries(Object.entries(d).map(([k, x]) => [k, Number(x.replace(',', '.'))])) }).then(() => { setNot('Öneri Genel Müdür Yardımcısı görüşüne gönderildi.'); setGer(''); return yukle(); }).catch((x) => setHata((x as Error).message)); }}>Değişikliği Öner</button>
      </div>}
    </>
  );
}

/** YG-794: öneri yalnız burada görünür; nihai risk derecesini yetkili rol verir. */
function SicilKarne({ id, onay, gerekce, yap }: { id: string; onay: boolean; gerekce: string; yap: (f: () => Promise<unknown>, t: string) => Promise<void> }) {
  const [v, setV] = useState<{ donem: { donem_puani: string | null; yetersiz_veri: boolean; kapanan_dosya_sayisi: number; risk_derecesi_onerisi: string; acik_emniyet_uygunsuzlugu: boolean } | null } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>(`/firma/${id}/karne`).then(setV).catch(() => setV(null)); }, [id]);
  if (!v?.donem) return null;
  const d = v.donem;
  return <div><div>Karne: {d.yetersiz_veri ? 'Yetersiz veri' : Number(d.donem_puani).toLocaleString('tr-TR')} · {d.kapanan_dosya_sayisi} dosya · Risk Derecesi Önerisi: {d.risk_derecesi_onerisi}{d.acik_emniyet_uygunsuzlugu ? ' · ⚠ Açık Emniyet Uygunsuzluğu' : ''}</div>{onay && <button className="btn2 kucuk" disabled={!gerekce.trim()} onClick={() => void yap(() => istek(`/firma/${id}/statu`, { risk: d.risk_derecesi_onerisi, gerekce }), 'Risk derecesi kaydedildi.')}>Öneriyi Risk Derecesi Yap</button>}</div>;
}

export function IbanTeyit() {
  const [l, setL] = useState<{ kimlik: string; ticari_unvan: string; iban: string }[]>([]); const [k, setK] = useState<Record<string, string>>({}); const [hata, setHata] = useState('');
  const yukle = () => istek<typeof l>('/banka-hesabi/bekleyen').then(setL).catch(() => setL([]));
  useEffect(() => { void yukle(); }, []);
  if (!l.length && !hata) return null;
  return (
    <>
      <div className="bolum">IBAN Teyidi</div>
      <div className="ozet">
        {hata && <div className="hata" role="alert">{hata}</div>}
        {l.map((x) => <div className="soru" key={x.kimlik}><span>{x.ticari_unvan} · {x.iban}</span><label htmlFor={`ib-${x.kimlik}`}>Teyit Kanalı</label><input id={`ib-${x.kimlik}`} value={k[x.kimlik] ?? ''} onChange={(e) => setK({ ...k, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" onClick={() => { setHata(''); void istek(`/banka-hesabi/${x.kimlik}/teyit`, { kanal: k[x.kimlik] }).then(yukle).catch((e) => setHata((e as Error).message)); }}>Teyit Et</button></div>)}
      </div>
    </>
  );
}

/** YG-263: aylık nöbet çizelgesi; Operasyon Müdürü onaylar. Dönem başından en az 10 gün önce yayımlanır. */
export function NobetCizelge() {
  const [ad, setAd] = useState<{ kimlik: string; ad_soyad: string }[]>([]); const [donem, setDonem] = useState(''); const [v, setV] = useState({ katman: 'Dosya Sorumlusu', kullanici: '', baslangic: '', bitis: '' });
  const [l, setL] = useState<(typeof v)[]>([]); const [deg, setDeg] = useState(false); const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  useEffect(() => { void istek<typeof ad>('/nobet/adaylar').then(setAd).catch((x) => setHata((x as Error).message)); }, []);
  return (
    <>
      <div className="bolum">Nöbet Çizelgesi</div>
      <div className="ozet">
        {hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}
        <label htmlFor="nb-d">Dönem (YYYY-AA)</label><input id="nb-d" value={donem} onChange={(e) => setDonem(e.target.value)} />
        <label htmlFor="nb-k">Katman</label><select id="nb-k" value={v.katman} onChange={(e) => setV({ ...v, katman: e.target.value })}>{['Dosya Sorumlusu', 'Teknik Uzman', 'Yönetici'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="nb-u">Kişi</label><select id="nb-u" value={v.kullanici} onChange={(e) => setV({ ...v, kullanici: e.target.value })}><option value="">Seçiniz</option>{ad.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>
        <div className="iki-tarih"><div><label htmlFor="nb-b">Başlangıç</label><input id="nb-b" type="datetime-local" value={v.baslangic} onChange={(e) => setV({ ...v, baslangic: e.target.value })} /></div><div><label htmlFor="nb-s">Bitiş</label><input id="nb-s" type="datetime-local" value={v.bitis} onChange={(e) => setV({ ...v, bitis: e.target.value })} /></div></div>
        <button className="btn2" disabled={!v.kullanici || !v.baslangic || !v.bitis} onClick={() => setL([...l, v])}>Vardiya Ekle</button>
        {l.map((x, n) => <div key={n}>{x.katman} · {ad.find((a) => a.kimlik === x.kullanici)?.ad_soyad} · {x.baslangic.replace('T', ' ')} – {x.bitis.replace('T', ' ')}</div>)}
        <label className="kutu"><input type="checkbox" checked={deg} onChange={(e) => setDeg(e.target.checked)} /><span>Yayımlanmış Çizelgede Değişiklik</span></label>
        <button className="btn2" disabled={!l.length} onClick={() => { setHata(''); setNot(''); void istek('/nobet/cizelge', { donem, degisiklik: deg, vardiyalar: l.map((x) => ({ ...x, baslangic: new Date(x.baslangic).toISOString(), bitis: new Date(x.bitis).toISOString() })) }).then(() => { setNot('Çizelge onaya gönderildi.'); setL([]); }).catch((x) => setHata((x as Error).message)); }}>Çizelgeyi Onaya Gönder</button>
      </div>
    </>
  );
}

/** YG-923: imzalı nüsha ve birlikte imza olmadan sözleşme yürürlüğe girmez; YG-915 haciz ihbarı Hukuk ve Uyum Direktörünce girilir. */
function FirmaSozlesme({ id, yap }: { id: string; yap: (f: () => Promise<unknown>, m: string) => Promise<void> }) {
  const [hz, setHz] = useState({ no: '', teblig: '', cevapSon: '' }); const [aS, setAS] = useState('');
  const [l, setL] = useState<{ kimlik: string; sozlesme_turu: string; yururluk: string; bitis: string | null; durum: string }[]>([]); const [f, setF] = useState({ tur: 'İş Birliği Firması Çerçeve Sözleşmesi', yururluk: '', bitis: '' }); const [bl, setBl] = useState(''); const [imza, setImza] = useState(false);
  const yukle = () => istek<typeof l>(`/firma/${id}/sozlesme`).then(setL).catch(() => setL([]));
  useEffect(() => { void yukle(); }, [id]);
  return (<>
    <label htmlFor="sz-t">Sözleşme Türü</label><select id="sz-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['İş Birliği Firması Çerçeve Sözleşmesi', 'Tedarikçi', 'Tedarik', 'Marina', 'Kurtarma', 'Teknik Uzmanlık', 'Ekipman Kiralama'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="sz-y">Yürürlük Tarihi</label><input id="sz-y" type="date" value={f.yururluk} onChange={(e) => setF({ ...f, yururluk: e.target.value })} />
    <label htmlFor="sz-b">Sözleşme Bitişi</label><input id="sz-b" type="date" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} />
    <button className="btn2" disabled={!f.yururluk} onClick={() => void yap(() => istek(`/firma/${id}/sozlesme`, { tur: f.tur, yururluk: f.yururluk, bitis: f.bitis || undefined }).then(yukle), 'Sözleşme taslağı açıldı.')}>Sözleşme Taslağı Aç</button>
    {l.map((s) => <div className="soru" key={s.kimlik}><span>{s.sozlesme_turu} · {s.yururluk.split('-').reverse().join('.')} · {s.durum}</span>
      {s.durum === 'Taslak' && <div className="tam"><BelgeSec ad={`İmzalı Nüsha ${s.sozlesme_turu}`} bagTuru="Kuruluş" bagKimligi={id} deger={bl} sec={setBl} /><label><input type="checkbox" checked={imza} onChange={(e) => setImza(e.target.checked)} /> Birlikte imza tamamlandı</label><button className="btn2 kucuk" disabled={!bl || !imza} onClick={() => void yap(() => istek(`/sozlesme/${s.kimlik}/yururluk`, { belge: bl, birlikteImza: imza }).then(yukle), 'Sözleşme yürürlüğe girdi.')}>Yürürlüğe Al</button></div>}
    </div>)}
    <label htmlFor="ac-s">Acil Arama Sırası</label><input id="ac-s" inputMode="numeric" value={aS} onChange={(e) => setAS(e.target.value)} />
    <button className="btn2" disabled={!aS} onClick={() => void yap(() => istek(`/firma/${id}/acil-bilgi`, { hizmetVerir: true, aramaSirasi: Number(aS) }), 'Firma acil hizmet verir olarak kaydedildi.')}>Acil Hizmet Ver</button>
    <label htmlFor="hz-n">Haciz İhbarname No</label><input id="hz-n" value={hz.no} onChange={(e) => setHz({ ...hz, no: e.target.value })} />
    <label htmlFor="hz-t">Tebliğ Zamanı</label><input id="hz-t" type="datetime-local" value={hz.teblig} onChange={(e) => setHz({ ...hz, teblig: e.target.value })} />
    <label htmlFor="hz-c">Cevap Son Günü</label><input id="hz-c" type="date" value={hz.cevapSon} onChange={(e) => setHz({ ...hz, cevapSon: e.target.value })} />
    <button className="btn hayir" disabled={!hz.no.trim() || !hz.teblig || !hz.cevapSon} onClick={() => void yap(() => istek(`/firma/${id}/haciz-ihbari`, hz), 'Firma carisi bloke edildi.')}>Haciz İhbarını Kaydet</button>
  </>);
}
