import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';
import { OlayKayitlari, SaglayiciMatrisi } from './DosyaEk';

const OLAY = ['Yanlış alıcıya e-posta', 'Açık paylaşım bağlantısı', 'Kayıp çıktı', 'Yetkisiz görüntüleme', 'Cihaz kaybı veya çalınması', 'Teknik güvenlik olayı', 'Diğer'];
const HAK = ['İşlenip işlenmediğini öğrenme', 'İşlenmişse bilgi talep etme', 'Amacını ve amaca uygun kullanımı öğrenme', 'Aktarıldığı üçüncü kişileri bilme', 'Düzeltme isteme', 'Silme veya yok etme isteme', 'Düzeltme/silmenin üçüncü kişilere bildirilmesi', 'Otomatik analiz sonucuna itiraz', 'Zararın giderilmesi', 'Pazarlama onayını geri alma'];

function useYap() {
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yap = async (f: () => Promise<unknown>, tamam: string) => { setHata(''); setNot(''); try { await f(); setNot(tamam); } catch (e) { setHata((e as Error).message); } };
  const Mesaj = () => <>{hata && <div className="hata" role="alert">{hata}</div>}{not && <div className="not">{not}</div>}</>;
  return { yap, Mesaj };
}

/** YG-1201: her ekrandan erişilir. */
export function IhlalBildir({ kapat }: { kapat: () => void }) {
  const [kt, setKt] = useState('');
  const { yap, Mesaj } = useYap(); const [t, setT] = useState(OLAY[0]!); const [o, setO] = useState('');
  return <div className="ozet"><b>⚠ Veri İhlali Bildir</b> (FR-HUK-002)<Mesaj />
    <label htmlFor="vi-t">Olay Türü</label><select id="vi-t" value={t} onChange={(e) => setT(e.target.value)}>{OLAY.map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="vi-o">Kısa Açıklama</label><textarea id="vi-o" value={o} onChange={(e) => setO(e.target.value)} />
    <label htmlFor="ih-kt">Karşı Taraf (verisi etkilenen firma veya kurum, varsa)</label><input id="ih-kt" value={kt} onChange={(e) => setKt(e.target.value)} />
    <div className="dugmeler"><button className="btn2" disabled={!o.trim()} onClick={() => void yap(() => istek('/veri-ihlali', { olayTuru: t, ozet: o, karsiTaraf: kt || undefined }).then(() => { setO(''); setKt(''); }), 'Bildiriminiz Bilgi İşlem Müdürü ile Hukuk ve Uyum Direktörüne iletildi.')}>Bildir</button><button className="btn2" onClick={kapat}>Kapat</button></div>
  </div>;
}

type Ihlal = { kimlik: string; olay_no: string; ozet: string; olay_turu: string; ogrenme_zamani: string; ust_yonetim_bilgi_zamani: string | null; bulgu_surumu: number; bildirim_karari: string | null; kurul_bildirim_zamani: string | null; durum: string };
type Basvuru = { kimlik: string; basvuru_no: string; basvuran_ad_soyad: string; son_yanit_tarihi: string; kimlik_dogrulandi: boolean; karar: string | null; durum: string; arama_sonucu: Record<string, number> | null };
type Liste = { kimlik: string; yil: number; imha_donemi: string; durum: string; kalemler: { kimlik: string; grup: string; ozet: string; durum: string; sorumlu_unvan: string }[] };

function kalan(z: string) { const s = (new Date(z).getTime() + 72 * 3_600_000 - Date.now()) / 3_600_000; return s < 0 ? '72 saat aşıldı' : `${Math.floor(s)} saat kaldı`; }

/** YG-1027 */
function RizaKayitlari() {
  const [l, setL] = useState<{ kimlik: string; ad_soyad: string; riza_turu: string; amac: string | null; kanal: string | null; durum: string; kaynak: string }[]>([]);
  useEffect(() => { void istek<typeof l>('/riza-kayitlari').then(setL).catch(() => {}); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Rıza ve Ticari İleti Kayıtları</div>{l.slice(0, 50).map((x) => <div className="ozet" key={x.kimlik}>{x.ad_soyad} · {x.riza_turu}{x.amac ? ` · ${x.amac}` : ''}{x.kanal ? ` · ${x.kanal}` : ''} · {x.durum} · {x.kaynak}</div>)}</>;
}

/** YG-1187: amaç ve dönemle arama. */
export function DenetimArama() {
  const { yap, Mesaj } = useYap(); const [f, setF] = useState({ amac: '', baslangic: '', bitis: '', eylem: '', tablo: '' }); const [v, setV] = useState<{ izler: { kimlik: string; olay_zamani: string; eylem: string; aktor: string | null; gerekce: string | null }[]; degisiklikler: { kimlik: string; zaman: string; tablo: string; nesne: string | null; aktor: string | null; degisen: object }[] } | null>(null);
  return <><div className="bolum">Amaçlı Denetim Araması</div><Mesaj />
    <label htmlFor="dn-a">Amaç</label><input id="dn-a" value={f.amac} onChange={(e) => setF({ ...f, amac: e.target.value })} />
    <div className="iki-tarih"><div><label htmlFor="dn-b">Başlangıç</label><input id="dn-b" type="date" value={f.baslangic} onChange={(e) => setF({ ...f, baslangic: e.target.value })} /></div><div><label htmlFor="dn-s">Bitiş</label><input id="dn-s" type="date" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} /></div></div>
    <label htmlFor="dn-e">Eylem</label><input id="dn-e" value={f.eylem} onChange={(e) => setF({ ...f, eylem: e.target.value })} /><label htmlFor="dn-t">Tablo</label><input id="dn-t" value={f.tablo} onChange={(e) => setF({ ...f, tablo: e.target.value })} />
    <button className="btn2" disabled={!f.amac.trim() || !f.baslangic || !f.bitis} onClick={() => void yap(() => istek<NonNullable<typeof v>>(`/denetim/arama?${new URLSearchParams(f).toString()}`).then(setV), 'Arama kayda geçti.')}>Ara</button>
    {v?.izler.slice(0, 100).map((x) => <div className="ozet" key={x.kimlik}>{new Date(x.olay_zamani).toLocaleString('tr-TR')} · {x.aktor ?? 'Sistem'} · {x.eylem}{x.gerekce ? ` · ${x.gerekce}` : ''}</div>)}
    {v?.degisiklikler.slice(0, 100).map((x) => <div className="ozet" key={x.kimlik}>{new Date(x.zaman).toLocaleString('tr-TR')} · {x.aktor ?? 'Sistem'} · {x.tablo} · {JSON.stringify(x.degisen).slice(0, 300)}</div>)}</>;
}

/** YG-1546, YG-1547: görev, kanıt, doğrulama. */
function UyumGorevleri() {
  const { yap, Mesaj } = useYap(); const [l, setL] = useState<{ kimlik: string; ad: string; son_tarih: string; sorumlu_rol: string; dogrulayan_rol: string; gerekli_kanit: string; durum: string }[]>([]); const [b, setB] = useState<Record<string, string>>({});
  const yk = () => istek<typeof l>('/uyum-gorevleri').then(setL);
  useEffect(() => { void yk().catch(() => {}); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Uyum Görevleri</div><Mesaj />{l.map((x) => <div className="soru" key={x.kimlik}><span>{x.ad} · Son: {x.son_tarih} · {x.durum}<br />Kanıt: {x.gerekli_kanit}</span><div className="tam">{x.durum === 'Açık' && <><BelgeSec ad="Uyum Kanıtı" bagTuru="Uyum Görevi" bagKimligi={x.kimlik} deger={b[x.kimlik] ?? ''} sec={(z: string) => setB({ ...b, [x.kimlik]: z })} /><button className="btn2 kucuk" disabled={!b[x.kimlik]} onClick={() => void yap(() => istek(`/uyum-gorevi/${x.kimlik}/kanit`, { belge: b[x.kimlik] }).then(yk), 'Kanıt yüklendi.')}>Kanıtı Kaydet</button></>}{x.durum === 'Kanıt Yüklendi' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/uyum-gorevi/${x.kimlik}/dogrula`, {}).then(yk), 'Görev kapatıldı.')}>Doğrula ve Kapat</button>}</div></div>)}</>;
}

/** YG-1276, YG-1642 */
function Yedekler() {
  const [v, setV] = useState<{ yedekler: { kimlik: string; tur: string; baslangic: string; durum: string; hata: string | null; satir_sayisi: string | null }[]; testler: { tur: string; sonuc: string; zaman: string }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/yedekler').then(setV).catch(() => {}); }, []);
  if (!v) return null;
  return <><div className="bolum">Yedekler</div>{v.yedekler.length === 0 && <div className="ozet bos">Yedek kaydı bulunmamaktadır.</div>}{v.yedekler.slice(0, 20).map((x) => <div className={x.durum === 'Başarısız' || x.durum === 'Eksik Set' ? 'hata' : 'ozet'} key={x.kimlik}>{new Date(x.baslangic).toLocaleString('tr-TR')} · {x.tur} · {x.durum}{x.hata ? ` · ${x.hata}` : ''}</div>)}{v.testler.map((x, i) => <div className="ozet" key={i}>{x.tur} · {x.sonuc} · {new Date(x.zaman).toLocaleDateString('tr-TR')}</div>)}</>;
}

export function KvkkEkrani() {
  const { yap, Mesaj } = useYap(); const [y, setY] = useState<{ ihlal: boolean; hud: boolean; uzman: boolean } | null>(null); const [iv, setIv] = useState<Ihlal[]>([]); const [bs, setBs] = useState<Basvuru[]>([]); const [il, setIl] = useState<Liste[]>([]); const [m, setM] = useState<Record<string, string>>({}); const [f, setF] = useState({ ad: '', iletisim: '', kanal: 'KEP', yanitKanali: '', talep: HAK[0]!, alinma: '' });
  const sec = (k: string) => m[k] ?? ''; const yz = (k: string, v: string) => setM({ ...m, [k]: v });
  const yukle = (r = y) => { if (!r) return; if (r.ihlal) void istek<Ihlal[]>('/veri-ihlali').then(setIv).catch(() => {}); if (r.hud || r.uzman) { void istek<Basvuru[]>('/kvkk-basvuru').then(setBs).catch(() => {}); void istek<Liste[]>('/imha-listesi').then(setIl).catch(() => {}); } };
  useEffect(() => { void istek<NonNullable<typeof y>>('/kvkk/yetki').then((r) => { setY(r); yukle(r); }); }, []);
  const [elle, setElle] = useState<Record<string, { gerekli: string[]; sec: string[] }>>({}); // YG-1220
  if (!y) return null;
  const is = (yol: string, g: object, t: string) => void yap(() => istek(yol, g).then(() => yukle()), t);
  return (<>
    <h1>KVKK ve Uyum</h1><Mesaj />
    <Yedekler />
    <UyumGorevleri />
    <SaglayiciMatrisi />
    <OlayKayitlari />
    {y.ihlal && <><div className="bolum">Veri İhlali Kayıtları</div>
      {iv.length === 0 && <div className="ozet bos">Kayıt bulunmamaktadır.</div>}
      {iv.map((v) => <div className="soru" key={v.kimlik}><span><b className="koyu">{v.olay_no}</b> · {v.olay_turu} · {v.ozet} · {v.durum}{v.durum === 'Açık' && !v.kurul_bildirim_zamani && v.bildirim_karari !== 'Bildirim Gerekmez' ? <b className="hata"> ⚠ {kalan(v.ogrenme_zamani)}</b> : ''}</span>
        {v.durum === 'Açık' && y.hud && <div className="tam">
          {!v.ust_yonetim_bilgi_zamani && <button className="btn2 kucuk" onClick={() => is(`/veri-ihlali/${v.kimlik}/degerlendir`, {}, 'Üst yönetim bilgilendirildi.')}>Değerlendirmeyi Başlat</button>}
          <label htmlFor={`b-${v.kimlik}`}>Bildirim Gerekmez Gerekçesi</label><input id={`b-${v.kimlik}`} value={sec(`b${v.kimlik}`)} onChange={(e) => yz(`b${v.kimlik}`, e.target.value)} />
          <div className="dugmeler"><button className="btn2 kucuk" onClick={() => is(`/veri-ihlali/${v.kimlik}/bildirim-karari`, { karar: 'Bildirilecek' }, 'Karar kaydedildi.')}>Kurula Bildirilecek</button><button className="btn2 kucuk" disabled={!sec(`b${v.kimlik}`).trim()} onClick={() => is(`/veri-ihlali/${v.kimlik}/bildirim-karari`, { karar: 'Bildirim Gerekmez', gerekce: sec(`b${v.kimlik}`) }, 'Karar kaydedildi.')}>Bildirim Gerekmez</button></div>
          <label htmlFor={`g-${v.kimlik}`}>Gecikme Gerekçesi (72 saat aşıldıysa)</label><input id={`g-${v.kimlik}`} value={sec(`g${v.kimlik}`)} onChange={(e) => yz(`g${v.kimlik}`, e.target.value)} />
          <button className="btn2 kucuk" onClick={() => is(`/veri-ihlali/${v.kimlik}/kurul-bildirimi`, { zaman: new Date().toISOString(), gecikme: sec(`g${v.kimlik}`) || undefined }, 'Kurul bildirimi kaydedildi.')}>Kurula Bildirildi</button>
          <button className="btn2 kucuk" onClick={() => is(`/veri-ihlali/${v.kimlik}/ilgili-kisi-bildirimi`, { zaman: new Date().toISOString() }, 'Kaydedildi.')}>İlgili Kişilere Bildirildi</button>
        </div>}
      </div>)}</>}
    {(y.hud || y.uzman) && <><div className="bolum">İlgili Kişi Başvuruları</div>
      {y.uzman && <>
        <label htmlFor="kb-a">Başvuran</label><input id="kb-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
        <label htmlFor="kb-i">İletişim</label><input id="kb-i" value={f.iletisim} onChange={(e) => setF({ ...f, iletisim: e.target.value })} />
        <label htmlFor="kb-k">Başvuru Kanalı</label><select id="kb-k" value={f.kanal} onChange={(e) => setF({ ...f, kanal: e.target.value })}>{['KEP', 'Yazılı başvuru (adres)', 'Sistemde kayıtlı e-posta'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="kb-y">Güvenli Yanıt Kanalı</label><input id="kb-y" value={f.yanitKanali} onChange={(e) => setF({ ...f, yanitKanali: e.target.value })} />
        <label htmlFor="kb-t">Talep Türü</label><select id="kb-t" value={f.talep} onChange={(e) => setF({ ...f, talep: e.target.value })}>{HAK.map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="kb-d">Alınma Tarihi</label><input id="kb-d" type="date" value={f.alinma} onChange={(e) => setF({ ...f, alinma: e.target.value })} />
        <button className="btn2" disabled={!f.ad.trim() || !f.alinma} onClick={() => is('/kvkk-basvuru', { ...f, talepler: [f.talep] }, 'Başvuru kaydedildi.')}>Başvuruyu Kaydet</button></>}
      {bs.map((a) => <div className="soru" key={a.kimlik}><span><b className="koyu">{a.basvuru_no}</b> · {a.basvuran_ad_soyad} · Son Yanıt: {a.son_yanit_tarihi} · {a.durum}{a.karar ? ` · ${a.karar}` : ''}</span>
        {y.uzman && a.durum === 'İncelemede' && <div className="tam">
          {!a.kimlik_dogrulandi && <button className="btn2 kucuk" onClick={() => is(`/kvkk-basvuru/${a.kimlik}/dogrula`, {}, 'Kimlik doğrulandı.')}>Kimlik Doğrulandı</button>}
          <label htmlFor={`t-${a.kimlik}`}>Arama Terimi (ad, telefon, e-posta)</label><input id={`t-${a.kimlik}`} value={sec(`t${a.kimlik}`)} onChange={(e) => yz(`t${a.kimlik}`, e.target.value)} />
          <button className="btn2 kucuk" disabled={sec(`t${a.kimlik}`).length < 3} onClick={() => void yap(() => istek<{ elleGerekli: string[] }>(`/kvkk-basvuru/${a.kimlik}/arama`, { terim: sec(`t${a.kimlik}`) }).then((r) => { setElle({ ...elle, [a.kimlik]: { gerekli: r.elleGerekli, sec: [] } }); yukle(); }), 'Arama tamamlandı; elle kontrol edilecek kaynakları işaretleyiniz.')}>Veri Ara</button>
          {elle[a.kimlik] && <>{elle[a.kimlik]!.gerekli.map((x) => <label className="kutu" key={x}><input type="checkbox" checked={elle[a.kimlik]!.sec.includes(x)} onChange={(e) => { const s = elle[a.kimlik]!.sec; setElle({ ...elle, [a.kimlik]: { ...elle[a.kimlik]!, sec: e.target.checked ? [...s, x] : s.filter((z) => z !== x) } }); }} /><span>{x} elle kontrol edildi</span></label>)}
            <button className="btn2 kucuk" disabled={elle[a.kimlik]!.sec.length === 0} onClick={() => is(`/kvkk-basvuru/${a.kimlik}/arama`, { terim: sec(`t${a.kimlik}`), elleKontrol: elle[a.kimlik]!.sec }, 'Elle kontroller kaydedildi.')}>Elle Kontrolleri Kaydet</button></>}
          {a.arama_sonucu && <div>{Object.entries(a.arama_sonucu).map(([k, n]) => `${k}: ${n}`).join(' · ')}</div>}
          <label htmlFor={`g2-${a.kimlik}`}>Karar Gerekçesi</label><input id={`g2-${a.kimlik}`} value={sec(`k${a.kimlik}`)} onChange={(e) => yz(`k${a.kimlik}`, e.target.value)} />
          <div className="dugmeler">{['Kabul', 'Kısmi Kabul', 'Ret'].map((x) => <button key={x} className="btn2 kucuk" disabled={!sec(`k${a.kimlik}`).trim()} onClick={() => is(`/kvkk-basvuru/${a.kimlik}/karar`, { karar: x, gerekce: sec(`k${a.kimlik}`) }, 'Karar onaya gönderildi.')}>{x}</button>)}</div>
        </div>}
      </div>)}
      <RizaKayitlari />
      <div className="bolum">İmha Listeleri</div>
      {il.length === 0 && <div className="ozet bos">İmha listesi bulunmamaktadır; listeler Ocak ve Temmuz aylarında oluşur.</div>}
      {il.map((l) => <div className="soru" key={l.kimlik}><span><b className="koyu">{l.yil} {l.imha_donemi}</b> · {l.durum} · {l.kalemler.filter((x) => x.durum === 'Listede').length} kayıt</span><div className="tam">
        {l.kalemler.map((x) => <div key={x.kimlik}>{x.grup} · {x.ozet} · {x.durum}{x.durum === 'Listede' && l.durum !== 'Onayda' && l.durum !== 'Uygulandı' && <><input aria-label="Çıkarma Gerekçesi" value={sec(`c${x.kimlik}`)} onChange={(e) => yz(`c${x.kimlik}`, e.target.value)} /><button className="btn2 kucuk" disabled={!sec(`c${x.kimlik}`).trim()} onClick={() => is(`/imha-kalemi/${x.kimlik}/cikar`, { gerekce: sec(`c${x.kimlik}`) }, 'Listeden çıkarıldı.')}>Listeden Çıkar</button></>}</div>)}
        {y.uzman && l.durum === 'Hazırlanıyor' && <button className="btn2 kucuk" onClick={() => is(`/imha-listesi/${l.kimlik}/birime-gonder`, {}, 'Birim kontrolüne gönderildi.')}>Birim Kontrolüne Gönder</button>}
      </div></div>)}</>}
  </>);
}
