import { useEffect, useState } from 'react';
import { istek, type Ben } from './api';

interface Firma { kimlik: string; sicil_no: string; ticari_unvan: string; kayit_rolu: string; kayit_asamasi: string; ag_statusu: string }

/** YG-344, YG-354, YG-928: firma sicili; IBAN karantinada başlar, Muhasebe ve Finans Müdürü bağımsız kanalla teyit eder. */
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
        </div>
      </>}
    </>
  );
}

/** YG-928: giren kişi teyit edemez; e-posta teyit sayılmaz. Yetkisiz kullanıcıya bölüm görünmez. */
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
