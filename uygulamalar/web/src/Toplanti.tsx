import { OnayaGonder } from './Dugme';
import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

interface Satir { kimlik: string; tpl_kod: string; tur: string; konu: string; baslangic: string; sure_dk: number; durum: string; oncelik: string }
interface Tur { kod: string; ad: string; katilimcilar: string; dosyaGerekli?: boolean }
interface Kisi { kimlik: string; ad_soyad: string }
interface Katilimci { kimlik: string; ad_soyad: string; katilim: string; vekil_durumu: string | null; vekil: string | null }
interface Ayrinti extends Satir {
  vekilMakami?: string | null;
  gundem: string | null; tutanak: string | null; baskan: string; duzenleyen: string; siklik: string; baskanim: boolean; duzenleyenim: boolean;
  katilimcilar: Katilimci[]; kararlar: { kimlik: string; metin: string; hedef: string; sorumlu: string; karar_turu: string; basari_olcutu: string | null; izleme_donemi: string | null }[];
}
const saat = (s: string) => new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
const gun = (s: string) => s.split('-').reverse().join('.');

/** Ek II §1.8; YG-576…YG-584: katalogdaki kodla adı birlikte görünür. */
export function Toplantilar() {
  const [liste, setListe] = useState<Satir[]>([]); const [sec, setSec] = useState<{ turler: Tur[]; kisiler: Kisi[] } | null>(null);
  const [acik, setAcik] = useState<string | null>(null); const [plan, setPlan] = useState(false); const [hata, setHata] = useState('');
  const yukle = () => istek<Satir[]>('/toplanti').then(setListe).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); void istek<{ turler: Tur[]; kisiler: Kisi[] }>('/toplanti/secenek').then(setSec).catch((e) => setHata(e.message)); }, []);
  if (acik) return <ToplantiAyrinti id={acik} kisiler={sec?.kisiler ?? []} geri={() => { setAcik(null); void yukle(); }} />;
  return (
    <>
      <h1>Toplantılar</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {!plan && <button className="btn" onClick={() => setPlan(true)}>Toplantı Planla</button>}
      {plan && sec && <PlanFormu sec={sec} bitti={(id) => { setPlan(false); void yukle(); if (id) setAcik(id); }} />}
      <div className="bolum">Toplantılarım</div>
      {liste.length === 0 && <div className="ozet bos">Toplantı bulunmamaktadır.</div>}
      {liste.length > 0 && (
        <div className="tablo"><table className="kartli">
          <thead><tr><th>Toplantı</th><th>Konu</th><th>Zaman</th><th>Durum</th><th /></tr></thead>
          <tbody>{liste.map((t) => (
            <tr key={t.kimlik}>
              <td data-ad="Toplantı">{t.tpl_kod} {t.tur}</td><td data-ad="Konu">{t.konu}</td><td data-ad="Zaman">{saat(t.baslangic)}</td><td data-ad="Durum">{t.durum}</td>
              <td data-ad="İşlem"><button className="btn2 kucuk" onClick={() => setAcik(t.kimlik)}>Aç</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <PeriyodikIsler />
      <GozdenGecirmeSorulari />
    </>
  );
}

function PlanFormu({ sec, bitti }: { sec: { turler: Tur[]; kisiler: Kisi[] }; bitti: (id?: string) => void }) {
  const [kod, setKod] = useState(sec.turler[sec.turler.length - 1]?.kod ?? ''); const [konu, setKonu] = useState(''); const [gundem, setGundem] = useState('');
  const [zaman, setZaman] = useState(''); const [sure, setSure] = useState(60); const [kritik, setKritik] = useState(false); const [dosyaNo, setDosyaNo] = useState('');
  const [secili, setSecili] = useState<Record<string, string>>({}); const [cakisan, setCakisan] = useState<string[]>([]); const [hata, setHata] = useState('');
  const tur = sec.turler.find((t) => t.kod === kod);
  const kisiler = Object.keys(secili);
  useEffect(() => {
    if (!zaman) { setCakisan([]); return; }
    void istek<{ cakisanlar: string[] }>('/toplanti/cakisma', { kisiler, baslangic: new Date(zaman).toISOString(), sureDk: sure }).then((r) => setCakisan(r.cakisanlar)).catch(() => setCakisan([]));
  }, [zaman, sure, kisiler.join()]);
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata('');
    try {
      const r = await istek<{ kimlik: string }>('/toplanti', { kod, konu, gundem, baslangic: new Date(zaman).toISOString(), sureDk: sure, kritik, dosyaNo: dosyaNo.trim() || undefined, katilimcilar: kisiler.map((k) => ({ kullanici: k, katilim: secili[k] })) });
      bitti(r.kimlik);
    } catch (x) { setHata((x as Error).message); }
  };
  return (
    <form className="ozet" onSubmit={(e) => void gonder(e)}>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <label htmlFor="t-k">Toplantı</label>
      <select required id="t-k" value={kod} onChange={(e) => { setKod(e.target.value); setKritik(false); }}>{sec.turler.map((t) => <option key={t.kod} value={t.kod}>{t.kod} {t.ad}</option>)}</select>
      {tur && <div className="not">Katılımcılar: {tur.katilimcilar}. Rolü belli olan katılımcılar otomatik eklenir.</div>}
      <label htmlFor="t-o">Konu</label>
      <input required id="t-o" value={konu} onChange={(e) => setKonu(e.target.value)} />
      <label htmlFor="t-d">İlgili Dosya No{tur?.dosyaGerekli ? '' : ' (Varsa)'}</label>
      <input id="t-d" value={dosyaNo} onChange={(e) => setDosyaNo(e.target.value)} />
      <label htmlFor="t-g">Gündem</label>
      <textarea id="t-g" rows={2} value={gundem} onChange={(e) => setGundem(e.target.value)} />
      <div className="iki-tarih">
        <div><label htmlFor="t-z">Tarih ve Saat</label><input required id="t-z" type="datetime-local" value={zaman} onChange={(e) => setZaman(e.target.value)} /></div>
        <div><label htmlFor="t-s">Süre (Dakika)</label><input id="t-s" type="number" min={5} max={600} value={sure} onChange={(e) => setSure(Number(e.target.value))} /></div>
      </div>
      <label>Katılımcı Ekle</label>
      {sec.kisiler.map((k) => (
        <div key={k.kimlik} className="iki-tarih">
          <label className="kutu"><input type="checkbox" checked={k.kimlik in secili} onChange={(e) => setSecili((o) => { const n = { ...o }; if (e.target.checked) n[k.kimlik] = 'Zorunlu'; else delete n[k.kimlik]; return n; })} /><span>{k.ad_soyad}</span></label>
          {k.kimlik in secili && <select aria-label={`${k.ad_soyad} katılım durumu`} value={secili[k.kimlik]} onChange={(e) => setSecili((o) => ({ ...o, [k.kimlik]: e.target.value }))}><option>Zorunlu</option><option>İsteğe Bağlı</option><option>Yalnız Bilgi</option></select>}
        </div>
      ))}
      {kod === 'TPL-10' && <label className="kutu"><input type="checkbox" checked={kritik} onChange={(e) => setKritik(e.target.checked)} /><span>Kritik Olay (Davet SMS ile de Gider)</span></label>}
      {cakisan.length > 0 && <div className="uyari"><b>Takvim Çakışması:</b> {cakisan.join(', ')}</div>}
      <button className="btn" disabled={!kod || !konu.trim() || !zaman}>Davet Gönder</button>
      <button type="button" className="lnk" onClick={() => bitti()}>Vazgeç</button>
    </form>
  );
}

function ToplantiAyrinti({ id, kisiler, geri }: { id: string; kisiler: Kisi[]; geri: () => void }) {
  const [t, setT] = useState<Ayrinti | null>(null); const [hata, setHata] = useState('');
  const [metin, setMetin] = useState(''); const [sorumlu, setSorumlu] = useState(''); const [hedef, setHedef] = useState(''); const [kTur, setKTur] = useState('Diğer'); const [kOlcut, setKOlcut] = useState(''); const [kIzleme, setKIzleme] = useState('');
  const [tutanak, setTutanak] = useState(''); const [vekil, setVekil] = useState('');
  const yukle = () => istek<Ayrinti>(`/toplanti/${id}`).then((x) => { setT(x); setTutanak(x.tutanak ?? ''); }).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, [id]);
  const yap = async (f: () => Promise<unknown>) => { setHata(''); try { await f(); await yukle(); } catch (x) { setHata((x as Error).message); } };
  if (!t) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  const acik = t.durum === 'Planlandı'; const yonetir = t.baskanim || t.duzenleyenim;
  return (
    <>
      <button className="lnk" onClick={geri}>← Toplantılar</button>
      <h1>{t.konu}</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <div className="ozet"><dl>
        <dt>Toplantı</dt><dd>{t.tpl_kod} {t.tur}</dd>
        <dt>Zaman</dt><dd>{saat(t.baslangic)} · {t.sure_dk} Dakika</dd>
        <dt>Başkan</dt><dd>{t.baskan}</dd>
        <dt>Düzenleyen</dt><dd>{t.duzenleyen}</dd>
        <dt>Durum</dt><dd>{t.durum}</dd>
        <dt>Gündem</dt><dd style={{ whiteSpace: 'pre-line' }}>{t.gundem ?? '—'}</dd>
      </dl></div>
      <div className="bolum">Katılımcılar</div>
      <div className="tablo"><table className="kartli">
        <thead><tr><th>Ad Soyad</th><th>Katılım</th><th>Vekil</th></tr></thead>
        <tbody>{t.katilimcilar.map((k) => <tr key={k.kimlik}><td data-ad="Ad Soyad">{k.ad_soyad}</td><td data-ad="Katılım">{k.katilim}</td><td data-ad="Vekil">{k.vekil ? `${k.vekil} · ${k.vekil_durumu}` : k.vekil_durumu ?? '—'}</td></tr>)}</tbody>
      </table></div>
      {acik && !t.baskanim && (
        <form className="ozet" onSubmit={(e) => { e.preventDefault(); void yap(() => istek(`/toplanti/${id}/vekil`, { vekil })); }}>
          <label htmlFor="t-v">Vekil Talep Et</label>
          <select required id="t-v" value={vekil} onChange={(e) => setVekil(e.target.value)}><option value="">Seçiniz</option>{kisiler.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select>
          <div className="not">Vekil, üst makamınızın en geç toplantıdan 1 saat önce vereceği onayla geçerlidir; onay yoksa mazeretli sayılırsınız.</div>
          {t.vekilMakami ? <OnayaGonder rol={t.vekilMakami} disabled={!vekil} /> : <button className="btn2" disabled={!vekil}>Onaya Gönder</button>}
        </form>
      )}
      <div className="bolum">Kararlar</div>
      {t.kararlar.length === 0 && <div className="ozet bos">Karar bulunmamaktadır.</div>}
      {t.kararlar.map((a) => <div key={a.kimlik} className="ozet"><b>{a.metin}</b><div className="not">{a.karar_turu} · {a.sorumlu} · Hedef: {gun(a.hedef)}{a.basari_olcutu ? ` · Başarı Ölçütü: ${a.basari_olcutu}` : ''}{a.izleme_donemi ? ` · İzleme: ${a.izleme_donemi}` : ''}</div></div>)}
      {acik && yonetir && (
        <form className="ozet" onSubmit={(e) => { e.preventDefault(); void yap(async () => { await istek(`/toplanti/${id}/karar`, { metin, sorumlu, hedef, tur: kTur, olcut: kOlcut || undefined, izleme: kIzleme || undefined }); setMetin(''); setSorumlu(''); setHedef(''); setKOlcut(''); setKIzleme(''); }); }}>
          <label htmlFor="t-m">Karar</label>
          <textarea required id="t-m" rows={2} value={metin} onChange={(e) => setMetin(e.target.value)} />
          <div className="iki-tarih">
            <div><label htmlFor="t-r">Sorumlu</label><select required id="t-r" value={sorumlu} onChange={(e) => setSorumlu(e.target.value)}><option value="">Seçiniz</option>{t.katilimcilar.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select></div>
            <div><label htmlFor="t-h">Hedef Tarih</label><input required id="t-h" type="date" value={hedef} onChange={(e) => setHedef(e.target.value)} /></div>
          </div>
          <div className="iki-tarih">
            <div><label htmlFor="t-kt">Karar Türü</label><select id="t-kt" value={kTur} onChange={(e) => setKTur(e.target.value)}>{['Diğer', 'Risk Kabulü', 'Kaynak Tahsisi', 'Öncelik', 'İyileştirme', 'Eğitim', 'Ek Denetim'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label htmlFor="t-iz">İzleme Dönemi</label><select id="t-iz" value={kIzleme} onChange={(e) => setKIzleme(e.target.value)}><option value="">Seçiniz</option>{['Tek Sefer', 'Haftalık', 'Aylık', 'Üç Aylık', 'Altı Aylık', 'Yıllık'].map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <label htmlFor="t-bo">Başarı Ölçütü</label><input id="t-bo" value={kOlcut} onChange={(e) => setKOlcut(e.target.value)} />
          <button className="btn2" disabled={!metin.trim() || !sorumlu || !hedef}>Karar Ekle</button>
        </form>
      )}
      <div className="bolum">Tutanak</div>
      {!acik && <div className="ozet" style={{ whiteSpace: 'pre-line' }}>{t.tutanak ?? '—'}</div>}
      {acik && !yonetir && <div className="ozet" style={{ whiteSpace: 'pre-line' }}>{t.tutanak ?? 'Tutanak henüz yazılmamıştır.'}</div>}
      {acik && yonetir && (
        <form className="ozet" onSubmit={(e) => { e.preventDefault(); void yap(() => istek(`/toplanti/${id}/tutanak`, { tutanak })); }}>
          <label htmlFor="t-t">Tutanak</label>
          <textarea required id="t-t" rows={4} value={tutanak} onChange={(e) => setTutanak(e.target.value)} />
          <button className="btn2" disabled={!tutanak.trim()}>Tutanağı Kaydet</button>
          {t.baskanim && <button type="button" className="btn" disabled={!t.tutanak} onClick={() => void yap(() => istek(`/toplanti/${id}/kapat`, {}))}>Onayla ve Kapat</button>}
          {t.duzenleyenim && <button type="button" className="lnk" onClick={() => void yap(() => istek(`/toplanti/${id}/iptal`, {}))}>Toplantıyı İptal Et</button>}
        </form>
      )}
    </>
  );
}

/** YG-1357: periyodik işler; tanımı Direktör, Genel Müdür Yardımcısı veya CEO girer. Tarih yaklaşınca sahibi role görev düşer. */
function PeriyodikIsler() {
  type P = { kimlik: string; ad: string; sahip_rol: string; periyot_ay: number; periyot_turu: string; sonraki_tarih: string | null; aktif: boolean; sahibim: boolean; son_karar: string | null };
  const [v, setV] = useState<{ isler: P[]; tanimlar: boolean; periyotTurleri: string[]; kontroller: string[]; roller: string[] } | null>(null); const [acik, setAcik] = useState(''); const [m, setM] = useState('');
  const [f, setF] = useState({ ad: '', sahipRol: '', periyotTuru: 'Aylık', periyotAy: '1', sonrakiTarih: '' }); const [gr, setGr] = useState(''); const [ol, setOl] = useState<Record<string, string>>({});
  const yk = () => istek<NonNullable<typeof v>>('/periyodik-isler').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const tr = (x: string) => x.split('-').reverse().join('.');
  return <><div className="bolum">Periyodik İşler</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{v.isler.length === 0 ? <div className="not">Tanımlı periyodik iş bulunmamaktadır.</div> : v.isler.map((x) => <div key={x.kimlik}>{x.ad} · {x.sahip_rol} · {x.periyot_turu === 'Aylık' && x.periyot_ay > 1 ? `${x.periyot_ay} ayda bir` : x.periyot_turu}{x.sonraki_tarih ? ` · Sonraki: ${tr(x.sonraki_tarih)}` : ''}{x.son_karar ? ` · Son karar: ${x.son_karar}` : ''}{x.aktif ? '' : ' · Pasif'}
      {x.aktif && (x.sahibim || v.tanimlar) && x.periyot_turu === 'Olaya Bağlı' && <><label htmlFor={`pi-o-${x.kimlik}`}>Olay</label><input required id={`pi-o-${x.kimlik}`} value={ol[x.kimlik] ?? ''} onChange={(e) => setOl({ ...ol, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!ol[x.kimlik]?.trim()} onClick={() => void istek(`/periyodik-is/${x.kimlik}/olay`, { olay: ol[x.kimlik] }).then(() => { setOl({}); setM('Görev açıldı.'); }).catch((e) => setM(e.message))}>Olayı Kaydet</button></>}
      {x.aktif && (x.sahibim || v.tanimlar) && !['Günlük', 'Haftalık', 'Olaya Bağlı'].includes(x.periyot_turu) && <button className="btn2 kucuk" onClick={() => setAcik(acik === x.kimlik ? '' : x.kimlik)}>Gözden Geçirme Sonucu</button>}
      {x.aktif && (x.sahibim || v.tanimlar) && !['Günlük', 'Haftalık', 'Olaya Bağlı'].includes(x.periyot_turu) && <GozdenGecirmePaketi id={x.kimlik} />}{/* YG-534, YG-804 */}
      {acik === x.kimlik && <GozdenGecirmeSonucu id={x.kimlik} kontroller={v.kontroller} bitti={() => { setAcik(''); setM('Gözden geçirme sonucu kaydedildi.'); void yk(); }} />}
      {v.tanimlar && <button className="btn2 kucuk" disabled={!gr.trim()} onClick={() => void istek(`/periyodik-is/${x.kimlik}/durum`, { aktif: !x.aktif, gerekce: gr }).then(() => { setGr(''); return yk(); }).catch((e) => setM(e.message))}>{x.aktif ? 'Pasife Al' : 'Etkinleştir'}</button>}</div>)}</div>
    {v.tanimlar && <><label htmlFor="pi-g">Durum Değişikliği Gerekçesi</label><input required id="pi-g" value={gr} onChange={(e) => setGr(e.target.value)} />
      <label htmlFor="pi-a">İş Adı</label><input required id="pi-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
      <label htmlFor="pi-r">Sahibi Rol</label><select required id="pi-r" value={f.sahipRol} onChange={(e) => setF({ ...f, sahipRol: e.target.value })}><option value="">Seçiniz</option>{v.roller.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="pi-pt">Periyot</label><select id="pi-pt" value={f.periyotTuru} onChange={(e) => setF({ ...f, periyotTuru: e.target.value })}>{v.periyotTurleri.map((x) => <option key={x}>{x}</option>)}</select>
      {f.periyotTuru === 'Aylık' && <><label htmlFor="pi-p">Kaç Ayda Bir</label><input id="pi-p" inputMode="numeric" value={f.periyotAy} onChange={(e) => setF({ ...f, periyotAy: e.target.value })} /></>}
      {f.periyotTuru !== 'Olaya Bağlı' && <><label htmlFor="pi-t">İlk Tarih</label><input required id="pi-t" type="date" value={f.sonrakiTarih} onChange={(e) => setF({ ...f, sonrakiTarih: e.target.value })} /></>}
      <button className="btn2" disabled={!f.ad.trim() || !f.sahipRol || (f.periyotTuru === 'Aylık' && !(Number(f.periyotAy) > 0)) || (f.periyotTuru !== 'Olaya Bağlı' && !f.sonrakiTarih)} onClick={() => void istek('/periyodik-is', { ...f, periyotAy: Number(f.periyotAy), sonrakiTarih: f.sonrakiTarih || undefined }).then(() => { setF({ ad: '', sahipRol: '', periyotTuru: 'Aylık', periyotAy: '1', sonrakiTarih: '' }); setM('Periyodik iş tanımlandı.'); return yk(); }).catch((e) => setM(e.message))}>Periyodik İş Tanımla</button></>}</>;
}

/** YG-534, YG-804: türüne göre derlenen gözden geçirme paketi ve önceki karar. */
type Paket = { donem: string | null; tur: string; onceki: { donem: string; karar: string; aciklama: string; kosul: string | null } | null; acikUygunsuzluk: { sinif: string; n: number }[]; sikayet: { acik: number; yil: number }; karne?: { oneri: string; n: number }[]; belgeSuresi?: { dolmus: number; yaklasan: number }; isHacmi?: { is_emri: number; firma: number } };
function GozdenGecirmePaketi({ id }: { id: string }) {
  const [p, setP] = useState<Paket | null>(null); const [m, setM] = useState('');
  if (!p) return <button className="btn2 kucuk" onClick={() => void istek<Paket>(`/periyodik-is/${id}/paket`).then(setP).catch((e) => setM(e.message))}>Gözden Geçirme Paketi</button>;
  return <div className="ozet" data-t="gg-paket">{m && <div className="not" role="status">{m}</div>}
    <div><b>Önceki Karar:</b> {p.onceki ? `${p.onceki.donem.split('-').reverse().join('.')} · ${p.onceki.karar} · ${p.onceki.aciklama}${p.onceki.kosul ? ` · Koşul: ${p.onceki.kosul}` : ''}` : 'İlk gözden geçirme'}</div>
    <div><b>Açık Uygunsuzluklar:</b> {p.acikUygunsuzluk.length ? p.acikUygunsuzluk.map((x) => `${x.sinif}: ${x.n}`).join(' · ') : 'Yok'}</div>
    <div><b>Şikâyetler:</b> Açık {p.sikayet.acik} · Son 12 ay {p.sikayet.yil}</div>
    {p.karne && <div><b>Karne:</b> {p.karne.length ? p.karne.map((x) => `${x.oneri}: ${x.n}`).join(' · ') : 'Kayıt yok'}</div>}
    {p.belgeSuresi && <div><b>Belge Süreleri:</b> Süresi dolmuş {p.belgeSuresi.dolmus} · 60 gün içinde dolacak {p.belgeSuresi.yaklasan}</div>}
    {p.isHacmi && <div><b>İş Hacmi (12 ay):</b> {p.isHacmi.is_emri} iş emri · {p.isHacmi.firma} firma</div>}
  </div>;
}

/** YG-1363: kontrol listesi ve sabit karar seçenekleri. */
function GozdenGecirmeSonucu({ id, kontroller: ortak, bitti }: { id: string; kontroller: string[]; bitti: () => void }) {
  const [kontroller, setKontroller] = useState<string[]>(ortak); // TZ-5: ortak maddeler + işe özgü onaylı sorular
  useEffect(() => { void istek<string[]>(`/periyodik-is/${id}/kontrol-listesi`).then(setKontroller).catch(() => setKontroller(ortak)); }, [id]);
  const [k, setK] = useState<Record<string, string>>({}); const [f, setF] = useState({ karar: 'Sürdür', aciklama: '', kosul: '', yeniPeriyotAy: '' }); const [m, setM] = useState('');
  return <div className="ozet">{m && <div className="not" role="status">{m}</div>}
    {kontroller.map((x, n) => <div key={x}><label htmlFor={`gg-${id}-${n}`}>{x}</label><select required id={`gg-${id}-${n}`} value={k[x] ?? ''} onChange={(e) => setK({ ...k, [x]: e.target.value })}><option value="">Seçiniz</option>{['Evet', 'Hayır', 'Uygulanamaz'].map((s) => <option key={s}>{s}</option>)}</select></div>)}
    <label htmlFor={`gg-${id}-k`}>Karar</label><select id={`gg-${id}-k`} value={f.karar} onChange={(e) => setF({ ...f, karar: e.target.value })}>{['Sürdür', 'Koşullu Sürdür', 'Değiştir', 'Askıya Al'].map((s) => <option key={s}>{s}</option>)}</select>
    {f.karar === 'Koşullu Sürdür' && <><label htmlFor={`gg-${id}-o`}>Koşul</label><input id={`gg-${id}-o`} value={f.kosul} onChange={(e) => setF({ ...f, kosul: e.target.value })} /></>}
    {f.karar === 'Değiştir' && <><label htmlFor={`gg-${id}-p`}>Yeni Periyot (Ay)</label><input id={`gg-${id}-p`} inputMode="numeric" value={f.yeniPeriyotAy} onChange={(e) => setF({ ...f, yeniPeriyotAy: e.target.value })} /></>}
    <label htmlFor={`gg-${id}-a`}>Açıklama</label><input required id={`gg-${id}-a`} value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
    <button className="btn2 kucuk" disabled={kontroller.some((x) => !k[x]) || !f.aciklama.trim()} onClick={() => void istek(`/periyodik-is/${id}/sonuc`, { karar: f.karar, kontroller: k, aciklama: f.aciklama, kosul: f.kosul || undefined, yeniPeriyotAy: f.yeniPeriyotAy ? Number(f.yeniPeriyotAy) : undefined }).then(bitti).catch((e) => setM(e.message))}>Sonucu Kaydet</button></div>;
}

type GgSoru = { kimlik: string; periyodik_ad: string; soru: string; sira: number; onayli: boolean; aktif: boolean };
/** YG-599, YG-1363, TZ-5: Kalite Müdürü türe özgü gözden geçirme sorularını onaylar, düzenler, kaldırır veya ekler. */
export function GozdenGecirmeSorulari() {
  const [l, setL] = useState<GgSoru[] | null>(null); const [d, setD] = useState<Record<string, string>>({}); const [ek, setEk] = useState({ periyodikAd: '', soru: '' }); const [m, setM] = useState('');
  const yk = () => istek<{ yetkili: boolean; sorular: GgSoru[] }>('/gozden-gecirme-sorulari').then((r) => setL(r.yetkili ? r.sorular : null)).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const gonder = (g: object, ok: string) => void istek('/gozden-gecirme-sorulari', g).then(() => { setM(ok); return yk(); }).catch((e) => setM(e.message));
  const turler = [...new Set(l.map((x) => x.periyodik_ad))];
  return <><div className="bolum">Gözden Geçirme Soruları</div>
    <div className="not">Ortak kontrol maddelerine ek, işe özgü sorulardır; onaylanan soru o işin gözden geçirmesinde yanıtlanması zorunlu madde olur.</div>
    {m && <div className="not" role="status">{m}</div>}
    <div className="not">{l.filter((x) => !x.onayli && x.aktif).length} soru onay bekliyor.</div>
    {l.some((x) => !x.onayli && x.aktif) && <div className="dugmeler"><button className="btn evet kucuk" onClick={() => gonder({ onayla: l.filter((x) => !x.onayli && x.aktif).map((x) => x.kimlik) }, 'Bekleyen sorular onaylandı.')}>Bekleyenlerin Tümünü Onayla</button></div>}
    {turler.map((tur) => <details key={tur}><summary>{tur} · {l.filter((x) => x.periyodik_ad === tur && x.aktif).length} soru</summary>
      {l.filter((x) => x.periyodik_ad === tur).map((x) => <div key={x.kimlik} className="soru"><input aria-label={`${tur} soru ${x.sira}`} value={d[x.kimlik] ?? x.soru} onChange={(e) => setD({ ...d, [x.kimlik]: e.target.value })} disabled={!x.aktif} />
        <span className="not">{!x.aktif ? 'Kaldırıldı' : x.onayli ? 'Onaylı' : 'Taslak'}</span>
        <div className="dugmeler">{x.aktif && <button className="btn2 kucuk" onClick={() => gonder({ duzenle: [{ kimlik: x.kimlik, soru: d[x.kimlik] ?? x.soru }] }, 'Soru kaydedildi ve onaylandı.')}>Kaydet ve Onayla</button>}
          {x.aktif && <button className="btn2 kucuk hayir" onClick={() => gonder({ duzenle: [{ kimlik: x.kimlik, aktif: false }] }, 'Soru kaldırıldı.')}>Kaldır</button>}</div></div>)}
    </details>)}
    <details><summary>Soru Ekle</summary>
      <label htmlFor="ggs-t">Periyodik İş</label><select id="ggs-t" value={ek.periyodikAd} onChange={(e) => setEk({ ...ek, periyodikAd: e.target.value })}><option value="">Seçiniz</option>{turler.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="ggs-s">Soru</label><input id="ggs-s" value={ek.soru} onChange={(e) => setEk({ ...ek, soru: e.target.value })} />
      <button className="btn2 kucuk" disabled={!ek.periyodikAd || !ek.soru.trim()} onClick={() => { gonder({ ekle: ek }, 'Soru eklendi.'); setEk({ periyodikAd: '', soru: '' }); }}>Ekle</button>
    </details>
  </>;
}
