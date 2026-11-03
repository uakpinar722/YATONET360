import { useEffect, useState, type ReactNode } from 'react';
import { istek, type Ben } from './api';
import { BelgeSec } from './Kalite';

const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;
const eur = (x: string | number | null) => (x === null ? '—' : `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);
const tarih = (s: string | null) => (s ? s.split('-').reverse().join('.') : '—');
const sayi = (x: string) => Number(x.replace(/\./g, '').replace(',', '.'));
function useYap(yenile: () => unknown) {
  const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  const yap = async (f: () => Promise<unknown>, t?: string) => { setHata(''); setNot(''); try { await f(); if (t) setNot(t); await yenile(); } catch (x) { setHata((x as Error).message); } };
  const Mesaj = () => <>{hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}</>;
  return { yap, Mesaj };
}

interface TesisV {
  kurulus: string;
  bekleyen: { kimlik: string; tur: string; hedef_tarih: string; aciklama: string | null; yat_adi: string; tam_boy_m: string | null; yat_turu: string | null }[];
  takvim: { kimlik: string; tur: string; hedef_tarih: string; tesis_izin_no: string | null; yat_adi: string }[];
  yatlar: { dosya: string; yat_adi: string; teslim: string | null; serbest_birakma_kodu: string | null }[];
  kayitlar: { kimlik: string; tur: string; baslik: string }[];
  faturalar: { kimlik: string; fatura_no: string; tarih: string; kalem: string; gun: number | null; tutar_eur: string; durum: string }[];
}

/** YG-1575, YG-1576 A8 Tesis: firma unvanı, müşteri fiyatı, firma maliyeti ve teknik dosya yoktur; dil naziktir. */
export function TesisAna({ ben }: { ben: Ben }) {
  const [v, setV] = useState<TesisV | null>(null); const [iz, setIz] = useState<Record<string, string>>({}); const [g, setG] = useState<Record<string, string>>({});
  const [k, setK] = useState({ tur: 'Tesis Kuralı', baslik: '', belge: '' }); const [f, setF] = useState({ talep: '', no: '', tarih: '', kalem: 'Çekek', gun: '', tutar: '', belge: '' });
  const yukle = () => istek<TesisV>('/tesis-portal/ana').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  if (!v) return <Mesaj />;
  return (
    <>
      <h1>Hoş Geldiniz, {ben.adSoyad}</h1><Mesaj />
      {v.yatlar.filter((y) => !y.teslim).map((y) => <div className="ood" role="status" key={y.dosya}>⚠ {y.yat_adi} yatının teslimi veya taşınması için LGM teslim onayını beklemenizi rica ederiz.<div className="dugmeler"><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/tesis-portal/dosya/${y.dosya}/teslim-talebi`, {}), 'Teslim talebiniz iletildi.')}>Teslim Talebi</button></div></div>)}
      {v.yatlar.filter((y) => y.teslim).map((y) => <div className="not" key={y.dosya}>{y.yat_adi}: Teslim onayı verilmiştir. Onay Kodu: {y.serbest_birakma_kodu}</div>)}
      <Blok baslik="Yanıt Bekleyenler">
        {v.bekleyen.length === 0 && <div className="not">Bekleyen talep bulunmamaktadır.</div>}
        {v.bekleyen.map((t) => (
          <div className="soru" key={t.kimlik}>
            <span><b className="koyu">{t.tur}</b> · {t.yat_adi} · {t.yat_turu ?? '—'}{t.tam_boy_m ? ` · ${Number(t.tam_boy_m).toLocaleString('tr-TR')} m` : ''} · {tarih(t.hedef_tarih)}</span>
            {t.aciklama && <div>{t.aciklama}</div>}
            <label htmlFor={`ti-${t.kimlik}`}>Tesis İzin Numarası</label><input id={`ti-${t.kimlik}`} value={iz[t.kimlik] ?? ''} onChange={(e) => setIz({ ...iz, [t.kimlik]: e.target.value })} />
            <button className="btn evet" onClick={() => void yap(() => istek(`/tesis-portal/talep/${t.kimlik}/yanit`, { izin: true, izinNo: iz[t.kimlik] }), 'Yanıtınız iletildi.')}>İzin Ver</button>
            <label htmlFor={`tg-${t.kimlik}`}>Gerekçe</label><input id={`tg-${t.kimlik}`} value={g[t.kimlik] ?? ''} onChange={(e) => setG({ ...g, [t.kimlik]: e.target.value })} />
            <button className="btn hayir" onClick={() => void yap(() => istek(`/tesis-portal/talep/${t.kimlik}/yanit`, { izin: false, gerekce: g[t.kimlik] }), 'Yanıtınız iletildi.')}>İzin Verme</button>
          </div>
        ))}
      </Blok>
      <Blok baslik="İş Takvimi">
        {v.takvim.length === 0 && <div className="not">Takvimde iş bulunmamaktadır.</div>}
        {v.takvim.map((t) => <div key={t.kimlik}>{tarih(t.hedef_tarih)} · {t.yat_adi} · {t.tur} · Onaylı{t.tesis_izin_no ? ` · İzin No: ${t.tesis_izin_no}` : ''}</div>)}
      </Blok>
      <Blok baslik="Faturalar">
        {v.faturalar.map((x) => <div key={x.kimlik}>{x.fatura_no} · {tarih(x.tarih)} · {x.kalem}{x.gun ? ` · ${x.gun} Gün` : ''} · {eur(x.tutar_eur)} · {x.durum}</div>)}
        <label htmlFor="tf-t">İş</label><select id="tf-t" value={f.talep} onChange={(e) => setF({ ...f, talep: e.target.value })}><option value="">Seçiniz</option>{v.takvim.map((t) => <option key={t.kimlik} value={t.kimlik}>{t.yat_adi} · {t.tur}</option>)}</select>
        <div className="iki-tarih"><div><label htmlFor="tf-n">Fatura No</label><input id="tf-n" value={f.no} onChange={(e) => setF({ ...f, no: e.target.value })} /></div><div><label htmlFor="tf-d">Fatura Tarihi</label><input id="tf-d" type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /></div></div>
        <label htmlFor="tf-k">Kalem</label><select id="tf-k" value={f.kalem} onChange={(e) => setF({ ...f, kalem: e.target.value })}>{['Çekek', 'Barınma', 'Bekleme ve Muhafaza', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
        {f.kalem === 'Bekleme ve Muhafaza' && <><label htmlFor="tf-g">Gün</label><input id="tf-g" inputMode="numeric" value={f.gun} onChange={(e) => setF({ ...f, gun: e.target.value })} /></>}
        <label htmlFor="tf-u">Tutar (EUR)</label><input id="tf-u" inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} />
        <BelgeSec ad="Fatura Belgesi" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={f.belge} sec={(x) => setF({ ...f, belge: x })} />
        <button className="btn2" disabled={!f.belge} onClick={() => void yap(() => istek('/tesis-portal/fatura', { ...f, tutar: sayi(f.tutar), gun: f.gun ? Number(f.gun) : undefined }), 'Faturanız kaydedildi.')}>Fatura Gönder</button>
      </Blok>
      <Blok baslik="Tesis Kuralları ve Tarife">
        {v.kayitlar.map((x) => <div key={x.kimlik}>{x.tur} · {x.baslik}</div>)}
        <label htmlFor="tk-t">Tür</label><select id="tk-t" value={k.tur} onChange={(e) => setK({ ...k, tur: e.target.value })}>{['Tesis Kuralı', 'Tarife'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="tk-b">Başlık</label><input id="tk-b" value={k.baslik} onChange={(e) => setK({ ...k, baslik: e.target.value })} />
        <BelgeSec ad="Kural veya Tarife Belgesi" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={k.belge} sec={(x) => setK({ ...k, belge: x })} />
        <button className="btn2" disabled={!k.belge} onClick={() => void yap(() => istek('/tesis-portal/kayit', k), 'Belgeniz kaydedildi.')}>Yükle</button>
      </Blok>
    </>
  );
}

interface TedarikciV {
  kurulus: string;
  talepler: { kimlik: string; talep_no: string; son_zaman: string; durum: string; kalemler: { kimlik: string; urun_tanimi: string; uretici_parca_no: string | null; miktar: string; birim: string; birim_fiyat_eur: string | null; teslim_suresi_gun: number | null }[] }[];
  siparisler: { kimlik: string; siparis_no: string; statu: string; kdv_haric_eur: string; teslim_tarihi: string; teslim_yeri: string; tedarikci_kabul: string | null; tedarikci_teslim_tarihi: string | null; sevk_var: boolean; kalemler: { urun_tanimi: string; uretici_parca_no: string; miktar: string; birim: string; birim_bedel_eur: string }[] }[];
  faturalar: { kimlik: string; fatura_no: string; tarih: string; tutar_eur: string; siparis_no: string; eslestirme: string | null }[];
}

/** YG-1577, YG-298 A9 Tedarikçi: yalnız kendi teklif ve siparişleri; müşteri kimliği yoktur. */
export function TedarikciAna({ ben }: { ben: Ben }) {
  const [v, setV] = useState<TedarikciV | null>(null); const [fy, setFy] = useState<Record<string, { fiyat: string; sure: string }>>({});
  const [ka, setKa] = useState<Record<string, { kod: string; teslim: string; gerekce: string }>>({});
  const [se, setSe] = useState<Record<string, { tarih: string; irsaliye: string; tasiyici: string; lot: string; belge: string }>>({});
  const [fa, setFa] = useState<Record<string, { no: string; tarih: string; tutar: string; belge: string }>>({});
  const yukle = () => istek<TedarikciV>('/tedarikci-portal/ana').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  if (!v) return <Mesaj />;
  const bekT = v.talepler.filter((t) => t.durum === 'Yanıt Bekliyor');
  return (
    <>
      <h1>Hoş Geldiniz, {ben.adSoyad}</h1><Mesaj />
      <Blok baslik="Teklif Talepleri">
        {bekT.length === 0 && <div className="not">Bekleyen teklif talebi bulunmamaktadır.</div>}
        {bekT.map((t) => (
          <div className="soru" key={t.kimlik}>
            <span><b className="koyu">{t.talep_no}</b> · Son: {new Date(t.son_zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })}</span>
            {t.kalemler.map((k) => { const a = fy[k.kimlik] ?? { fiyat: '', sure: '' }; return <div key={k.kimlik}><div>{k.urun_tanimi}{k.uretici_parca_no ? ` · ${k.uretici_parca_no}` : ''} · {k.miktar} {k.birim}</div><div className="iki-tarih"><div><label htmlFor={`tf-${k.kimlik}`}>Birim Fiyat (EUR)</label><input id={`tf-${k.kimlik}`} inputMode="decimal" value={a.fiyat} onChange={(e) => setFy({ ...fy, [k.kimlik]: { ...a, fiyat: e.target.value } })} /></div><div><label htmlFor={`ts-${k.kimlik}`}>Teslim Süresi (Gün)</label><input id={`ts-${k.kimlik}`} inputMode="numeric" value={a.sure} onChange={(e) => setFy({ ...fy, [k.kimlik]: { ...a, sure: e.target.value } })} /></div></div></div>; })}
            <button className="btn2" onClick={() => void yap(() => istek(`/tedarikci-portal/talep/${t.kimlik}/yanit`, { kalemler: t.kalemler.map((k) => ({ kimlik: k.kimlik, fiyat: sayi(fy[k.kimlik]?.fiyat ?? ''), sure: Number(fy[k.kimlik]?.sure ?? '') })) }), 'Teklifiniz iletildi; geçerlilik 30 gündür.')}>Teklifi Gönder</button>
          </div>
        ))}
      </Blok>
      <Blok baslik="Siparişler">
        {v.siparisler.length === 0 && <div className="not">Sipariş bulunmamaktadır.</div>}
        {v.siparisler.map((s) => {
          const a = ka[s.kimlik] ?? { kod: '', teslim: '', gerekce: '' }; const b = se[s.kimlik] ?? { tarih: '', irsaliye: '', tasiyici: '', lot: '', belge: '' }; const c = fa[s.kimlik] ?? { no: '', tarih: '', tutar: '', belge: '' };
          return (
            <div className="soru" key={s.kimlik}>
              <span><b className="koyu">{s.siparis_no}</b> · {s.statu} · {eur(s.kdv_haric_eur)} (KDV Hariç) · Teslim Yeri: {s.teslim_yeri}</span>
              {s.kalemler.map((k) => <div key={k.uretici_parca_no + k.urun_tanimi}>{k.urun_tanimi} · {k.uretici_parca_no} · {k.miktar} {k.birim} · {eur(k.birim_bedel_eur)}</div>)}
              {s.statu === 'Verildi' && !s.tedarikci_kabul && <>
                <div className="iki-tarih"><div><label htmlFor={`sk-t-${s.kimlik}`}>Teslim Tarihi</label><input id={`sk-t-${s.kimlik}`} type="date" value={a.teslim} onChange={(e) => setKa({ ...ka, [s.kimlik]: { ...a, teslim: e.target.value } })} /></div><div><label htmlFor={`sk-k-${s.kimlik}`}>Onay Kodu</label><input id={`sk-k-${s.kimlik}`} inputMode="numeric" value={a.kod} onChange={(e) => setKa({ ...ka, [s.kimlik]: { ...a, kod: e.target.value } })} /></div></div>
                <button className="btn evet" onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/yanit`, { kabul: true, kod: a.kod, teslim: a.teslim }), 'Siparişi kabul ettiniz.')}>Siparişi Kabul Ediyorum</button>
                <label htmlFor={`sk-g-${s.kimlik}`}>Gerekçe</label><input id={`sk-g-${s.kimlik}`} value={a.gerekce} onChange={(e) => setKa({ ...ka, [s.kimlik]: { ...a, gerekce: e.target.value } })} />
                <button className="btn hayir" onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/yanit`, { kabul: false, gerekce: a.gerekce }), 'Yanıtınız iletildi.')}>Kabul Etmiyorum</button>
              </>}
              {s.tedarikci_kabul === 'Kabul' && <div>Söz Verilen Teslim: {tarih(s.tedarikci_teslim_tarihi)}{s.sevk_var ? ' · Sevk Edildi' : ''}</div>}
              {s.tedarikci_kabul === 'Kabul' && !s.sevk_var && <>
                <div className="iki-tarih"><div><label htmlFor={`sv-t-${s.kimlik}`}>Sevk Tarihi</label><input id={`sv-t-${s.kimlik}`} type="date" value={b.tarih} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, tarih: e.target.value } })} /></div><div><label htmlFor={`sv-i-${s.kimlik}`}>İrsaliye No</label><input id={`sv-i-${s.kimlik}`} value={b.irsaliye} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, irsaliye: e.target.value } })} /></div></div>
                <div className="iki-tarih"><div><label htmlFor={`sv-s-${s.kimlik}`}>Taşıyıcı</label><input id={`sv-s-${s.kimlik}`} value={b.tasiyici} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, tasiyici: e.target.value } })} /></div><div><label htmlFor={`sv-l-${s.kimlik}`}>Lot No</label><input id={`sv-l-${s.kimlik}`} value={b.lot} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, lot: e.target.value } })} /></div></div>
                <BelgeSec ad="İrsaliye ve Sertifika" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={b.belge} sec={(x) => setSe({ ...se, [s.kimlik]: { ...b, belge: x } })} />
                <button className="btn2" disabled={!b.belge} onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/sevk`, b), 'Sevk bildiriminiz iletildi.')}>Sevk Bildir</button>
              </>}
              {s.tedarikci_kabul === 'Kabul' && <>
                <div className="iki-tarih"><div><label htmlFor={`sf-n-${s.kimlik}`}>Fatura No</label><input id={`sf-n-${s.kimlik}`} value={c.no} onChange={(e) => setFa({ ...fa, [s.kimlik]: { ...c, no: e.target.value } })} /></div><div><label htmlFor={`sf-t-${s.kimlik}`}>Fatura Tarihi</label><input id={`sf-t-${s.kimlik}`} type="date" value={c.tarih} onChange={(e) => setFa({ ...fa, [s.kimlik]: { ...c, tarih: e.target.value } })} /></div></div>
                <label htmlFor={`sf-u-${s.kimlik}`}>KDV Hariç Tutar (EUR)</label><input id={`sf-u-${s.kimlik}`} inputMode="decimal" value={c.tutar} onChange={(e) => setFa({ ...fa, [s.kimlik]: { ...c, tutar: e.target.value } })} />
                <BelgeSec ad="Fatura Belgesi" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={c.belge} sec={(x) => setFa({ ...fa, [s.kimlik]: { ...c, belge: x } })} />
                <button className="btn2" disabled={!c.belge} onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/fatura`, { no: c.no, tarih: c.tarih, tutar: sayi(c.tutar), belge: c.belge }), 'Faturanız kaydedildi.')}>Fatura Gönder</button>
              </>}
            </div>
          );
        })}
      </Blok>
      {v.faturalar.length > 0 && <Blok baslik="Faturalarım">{v.faturalar.map((f) => <div key={f.kimlik}>{f.fatura_no} · {f.siparis_no} · {eur(f.tutar_eur)} · {f.eslestirme ?? 'Kontrolde'}</div>)}</Blok>}
    </>
  );
}

interface TesisTalep { kimlik: string; tur: string; hedef_tarih: string; durum: string; tesis_izin_no: string | null; red_gerekcesi: string | null; ticari_unvan: string }

/** YG-1447: dosya içinde Tesis İşlemleri listesi; açmak Dosya Sorumlusunun işidir. */
export function TesisIslemleri({ id, ds }: { id: string; ds: boolean }) {
  const [l, setL] = useState<TesisTalep[]>([]); const [t, setT] = useState<{ kimlik: string; ticari_unvan: string }[]>([]); const [f, setF] = useState({ tesis: '', tur: 'Saha Girişi', hedef: '', aciklama: '' });
  const yukle = () => istek<TesisTalep[]>(`/dosya/${id}/tesis-talepleri`).then(setL);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => {}); if (ds) void istek<typeof t>('/tesis-listesi').then(setT).catch(() => {}); }, [id]);
  if (!ds && !l.length) return null;
  return (
    <Blok baslik="Tesis İşlemleri">
      <Mesaj />
      {l.map((x) => <div key={x.kimlik}>{x.ticari_unvan} · {x.tur} · {tarih(x.hedef_tarih)} · {x.durum}{x.tesis_izin_no ? ` · İzin No: ${x.tesis_izin_no}` : ''}{x.red_gerekcesi ? ` · ${x.red_gerekcesi}` : ''}</div>)}
      {ds && <>
        <label htmlFor="tis-t">Tesis</label><select id="tis-t" value={f.tesis} onChange={(e) => setF({ ...f, tesis: e.target.value })}><option value="">Seçiniz</option>{t.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ticari_unvan}</option>)}</select>
        <label htmlFor="tis-u">İşlem</label><select id="tis-u" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Saha Girişi', 'Çalışma İzni', 'Çekek Randevusu', 'Kalış Uzatma'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="tis-h">Hedef Tarih</label><input id="tis-h" type="date" value={f.hedef} onChange={(e) => setF({ ...f, hedef: e.target.value })} />
        <label htmlFor="tis-a">Açıklama</label><input id="tis-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/tesis-talebi`, f), 'Talep tesise iletildi.')}>Tesise Talep Gönder</button>
      </>}
    </Blok>
  );
}

interface TeklifTalebi { kimlik: string; talep_no: string; durum: string; gecerlilik: string | null; ticari_unvan: string; kalemler: { urun_tanimi: string; miktar: string; birim: string; birim_fiyat_eur: string | null; teslim_suresi_gun: number | null }[] }

/** YG-298: tedarikçiden teklif talebi; Tedarik Sorumlusu açar. */
export function TeklifTalebiBolumu({ id, roller }: { id: string; roller: string[] }) {
  const [l, setL] = useState<TeklifTalebi[]>([]); const [ted, setTed] = useState<{ kimlik: string; ticari_unvan: string; engel: string | null }[]>([]); const [f, setF] = useState({ tedarikci: '', sonZaman: '', tanim: '', parcaNo: '', miktar: '1', birim: 'adet' });
  const ts = roller.includes('Tedarik Sorumlusu');
  const yukle = () => istek<TeklifTalebi[]>(`/dosya/${id}/teklif-talepleri`).then(setL);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => {}); if (ts) void istek<typeof ted>('/firma/uygunluk?rol=Tedarikçi').then(setTed).catch(() => {}); }, [id]);
  if (!ts && !l.length) return null;
  return (
    <Blok baslik="Tedarikçi Teklif Talepleri">
      <Mesaj />
      {l.map((t) => <div className="soru" key={t.kimlik}><span>{t.talep_no} · {t.ticari_unvan} · {t.durum}{t.gecerlilik ? ` · Geçerlilik: ${tarih(t.gecerlilik)}` : ''}</span>{t.kalemler.map((k, n) => <div key={n}>{k.urun_tanimi} · {k.miktar} {k.birim}{k.birim_fiyat_eur !== null ? ` · ${eur(k.birim_fiyat_eur)} · ${k.teslim_suresi_gun} Gün` : ''}</div>)}</div>)}
      {ts && <>
        <label htmlFor="tt-t">Tedarikçi</label><select id="tt-t" value={f.tedarikci} onChange={(e) => setF({ ...f, tedarikci: e.target.value })}><option value="">Seçiniz</option>{ted.filter((x) => !x.engel).map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ticari_unvan}</option>)}</select>
        <label htmlFor="tt-s">Yanıt Son Zamanı</label><input id="tt-s" type="datetime-local" value={f.sonZaman} onChange={(e) => setF({ ...f, sonZaman: e.target.value })} />
        <label htmlFor="tt-u">Ürün</label><input id="tt-u" value={f.tanim} onChange={(e) => setF({ ...f, tanim: e.target.value })} />
        <label htmlFor="tt-p">Üretici Parça No</label><input id="tt-p" value={f.parcaNo} onChange={(e) => setF({ ...f, parcaNo: e.target.value })} />
        <div className="iki-tarih"><div><label htmlFor="tt-m">Miktar</label><input id="tt-m" inputMode="decimal" value={f.miktar} onChange={(e) => setF({ ...f, miktar: e.target.value })} /></div><div><label htmlFor="tt-b">Birim</label><input id="tt-b" value={f.birim} onChange={(e) => setF({ ...f, birim: e.target.value })} /></div></div>
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/teklif-talebi`, { tedarikci: f.tedarikci, sonZaman: f.sonZaman && new Date(f.sonZaman).toISOString(), kalemler: [{ tanim: f.tanim, parcaNo: f.parcaNo, miktar: sayi(f.miktar), birim: f.birim }] }), 'Teklif talebi gönderildi.')}>Teklif Talebi Gönder</button>
      </>}
    </Blok>
  );
}
