import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

interface Satir { kimlik: string; tpl_kod: string; tur: string; konu: string; baslangic: string; sure_dk: number; durum: string; oncelik: string }
interface Tur { kod: string; ad: string; katilimcilar: string }
interface Kisi { kimlik: string; ad_soyad: string }
interface Katilimci { kimlik: string; ad_soyad: string; katilim: string; vekil_durumu: string | null; vekil: string | null }
interface Ayrinti extends Satir {
  gundem: string | null; tutanak: string | null; baskan: string; duzenleyen: string; siklik: string; baskanim: boolean; duzenleyenim: boolean;
  katilimcilar: Katilimci[]; kararlar: { kimlik: string; metin: string; hedef: string; sorumlu: string }[];
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
    </>
  );
}

function PlanFormu({ sec, bitti }: { sec: { turler: Tur[]; kisiler: Kisi[] }; bitti: (id?: string) => void }) {
  const [kod, setKod] = useState(sec.turler[sec.turler.length - 1]?.kod ?? ''); const [konu, setKonu] = useState(''); const [gundem, setGundem] = useState('');
  const [zaman, setZaman] = useState(''); const [sure, setSure] = useState(60); const [kritik, setKritik] = useState(false);
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
      const r = await istek<{ kimlik: string }>('/toplanti', { kod, konu, gundem, baslangic: new Date(zaman).toISOString(), sureDk: sure, kritik, katilimcilar: kisiler.map((k) => ({ kullanici: k, katilim: secili[k] })) });
      bitti(r.kimlik);
    } catch (x) { setHata((x as Error).message); }
  };
  return (
    <form className="ozet" onSubmit={(e) => void gonder(e)}>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <label htmlFor="t-k">Toplantı</label>
      <select id="t-k" value={kod} onChange={(e) => { setKod(e.target.value); setKritik(false); }}>{sec.turler.map((t) => <option key={t.kod} value={t.kod}>{t.kod} {t.ad}</option>)}</select>
      {tur && <div className="not">Katılımcılar: {tur.katilimcilar}. Rolü belli olan katılımcılar otomatik eklenir.</div>}
      <label htmlFor="t-o">Konu</label>
      <input id="t-o" value={konu} onChange={(e) => setKonu(e.target.value)} />
      <label htmlFor="t-g">Gündem</label>
      <textarea id="t-g" rows={2} value={gundem} onChange={(e) => setGundem(e.target.value)} />
      <div className="iki-tarih">
        <div><label htmlFor="t-z">Tarih ve Saat</label><input id="t-z" type="datetime-local" value={zaman} onChange={(e) => setZaman(e.target.value)} /></div>
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
  const [metin, setMetin] = useState(''); const [sorumlu, setSorumlu] = useState(''); const [hedef, setHedef] = useState('');
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
          <select id="t-v" value={vekil} onChange={(e) => setVekil(e.target.value)}><option value="">Seçiniz</option>{kisiler.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select>
          <div className="not">Vekil, üst makamınızın en geç toplantıdan 1 saat önce vereceği onayla geçerlidir; onay yoksa mazeretli sayılırsınız.</div>
          <button className="btn2" disabled={!vekil}>Onaya Gönder</button>
        </form>
      )}
      <div className="bolum">Kararlar</div>
      {t.kararlar.length === 0 && <div className="ozet bos">Karar bulunmamaktadır.</div>}
      {t.kararlar.map((a) => <div key={a.kimlik} className="ozet"><b>{a.metin}</b><div className="not">{a.sorumlu} · Hedef: {gun(a.hedef)}</div></div>)}
      {acik && yonetir && (
        <form className="ozet" onSubmit={(e) => { e.preventDefault(); void yap(async () => { await istek(`/toplanti/${id}/karar`, { metin, sorumlu, hedef }); setMetin(''); setSorumlu(''); setHedef(''); }); }}>
          <label htmlFor="t-m">Karar</label>
          <textarea id="t-m" rows={2} value={metin} onChange={(e) => setMetin(e.target.value)} />
          <div className="iki-tarih">
            <div><label htmlFor="t-r">Sorumlu</label><select id="t-r" value={sorumlu} onChange={(e) => setSorumlu(e.target.value)}><option value="">Seçiniz</option>{t.katilimcilar.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select></div>
            <div><label htmlFor="t-h">Hedef Tarih</label><input id="t-h" type="date" value={hedef} onChange={(e) => setHedef(e.target.value)} /></div>
          </div>
          <button className="btn2" disabled={!metin.trim() || !sorumlu || !hedef}>Karar Ekle</button>
        </form>
      )}
      <div className="bolum">Tutanak</div>
      {!acik && <div className="ozet" style={{ whiteSpace: 'pre-line' }}>{t.tutanak ?? '—'}</div>}
      {acik && !yonetir && <div className="ozet" style={{ whiteSpace: 'pre-line' }}>{t.tutanak ?? 'Tutanak henüz yazılmamıştır.'}</div>}
      {acik && yonetir && (
        <form className="ozet" onSubmit={(e) => { e.preventDefault(); void yap(() => istek(`/toplanti/${id}/tutanak`, { tutanak })); }}>
          <label htmlFor="t-t">Tutanak</label>
          <textarea id="t-t" rows={4} value={tutanak} onChange={(e) => setTutanak(e.target.value)} />
          <button className="btn2" disabled={!tutanak.trim()}>Tutanağı Kaydet</button>
          {t.baskanim && <button type="button" className="btn" disabled={!t.tutanak} onClick={() => void yap(() => istek(`/toplanti/${id}/kapat`, {}))}>Onayla ve Kapat</button>}
          {t.duzenleyenim && <button type="button" className="lnk" onClick={() => void yap(() => istek(`/toplanti/${id}/iptal`, {}))}>Toplantıyı İptal Et</button>}
        </form>
      )}
    </>
  );
}
