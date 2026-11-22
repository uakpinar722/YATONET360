import { useEffect, useState } from 'react';
import { damga, tarih, tarihSaat } from './bicim';
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
    {v?.izler.slice(0, 100).map((x) => <div className="ozet" key={x.kimlik}>{damga(x.olay_zamani)} · {x.aktor ?? 'Sistem'} · {x.eylem}{x.gerekce ? ` · ${x.gerekce}` : ''}</div>)}
    {v?.degisiklikler.slice(0, 100).map((x) => <div className="ozet" key={x.kimlik}>{damga(x.zaman)} · {x.aktor ?? 'Sistem'} · {x.tablo} · {JSON.stringify(x.degisen).slice(0, 300)}</div>)}</>;
}

/** YG-1546, YG-1547: görev, kanıt, doğrulama. */
function UyumGorevleri() {
  const { yap, Mesaj } = useYap(); const [l, setL] = useState<{ kimlik: string; ad: string; son_tarih: string; sorumlu_rol: string; dogrulayan_rol: string; gerekli_kanit: string; durum: string; renk?: string }[]>([]); const [b, setB] = useState<Record<string, string>>({});
  const yk = () => istek<typeof l>('/uyum-gorevleri').then(setL);
  useEffect(() => { void yk().catch(() => {}); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Uyum Görevleri</div><Mesaj />{l.map((x) => <div className="soru" key={x.kimlik}><span><em className={`rozet ${x.renk ?? 'gri'}`}>{x.renk === 'kirmizi' ? 'Gecikti' : x.renk === 'sari' ? 'Süresi Yaklaşıyor' : 'Süresi Var'}</em> {x.ad} · Son: {x.son_tarih} · {x.durum}<br />Kanıt: {x.gerekli_kanit}</span><div className="tam">{x.durum === 'Açık' && <><BelgeSec ad="Uyum Kanıtı" bagTuru="Uyum Görevi" bagKimligi={x.kimlik} deger={b[x.kimlik] ?? ''} sec={(z: string) => setB({ ...b, [x.kimlik]: z })} /><button className="btn2 kucuk" disabled={!b[x.kimlik]} onClick={() => void yap(() => istek(`/uyum-gorevi/${x.kimlik}/kanit`, { belge: b[x.kimlik] }).then(yk), 'Kanıt yüklendi.')}>Kanıtı Kaydet</button></>}{x.durum === 'Kanıt Yüklendi' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/uyum-gorevi/${x.kimlik}/dogrula`, {}).then(yk), 'Görev kapatıldı.')}>Doğrula ve Kapat</button>}</div></div>)}</>;
}

/** YG-1544: VERBİS eşik kontrolü; önceki yılın ortalama çalışan sayısı ve bilanço toplamı eşiklerle; bilanço Muhasebe ve Finans Müdürünce girilir. */
function VerbisEsik() {
  const [v, setV] = useState<{ yil: number; ortalamaCalisan: number; bilancoTl: number | null; calisanEsigi: number; bilancoEsigi: number; asildi: boolean } | null>(null); const [tl, setTl] = useState(''); const [m, setM] = useState('');
  useEffect(() => { void istek<NonNullable<typeof v>>('/verbis-esik').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const sayi = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <><div className="bolum">VERBİS Eşik Kontrolü · {v.yil}</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet"><div>Ortalama Çalışan Sayısı: {v.ortalamaCalisan.toLocaleString('tr-TR')} (Eşik: {v.calisanEsigi})</div><div>Yıllık Bilanço Toplamı: {v.bilancoTl === null ? 'Girilmedi' : `${sayi(v.bilancoTl)} TL`} (Eşik: {sayi(v.bilancoEsigi)} TL)</div><div><b>{v.asildi ? 'Eşik aşıldı; VERBİS kaydı görevi açıldı.' : 'Eşik aşılmadı.'}</b></div></div>
    <label htmlFor="vb-tl">Bilanço Toplamı (TL)</label><input id="vb-tl" inputMode="decimal" value={tl} onChange={(e) => setTl(e.target.value)} />
    <button className="btn2" disabled={!tl} onClick={() => void istek<NonNullable<typeof v>>('/yillik-bilanco', { yil: v.yil, toplamTl: Number(tl.replace(/\./g, '').replace(',', '.')) }).then((r) => { setV(r); setTl(''); setM('Bilanço toplamı kaydedildi.'); }).catch((e) => setM(e.message))}>Bilanço Toplamını Kaydet</button></>;
}

/** YG-1000: hizmet hesabı envanteri; envantere girmemiş hizmet hesapları ayrıca listelenir. */
function HizmetHesaplari() {
  type H = { kullanici_ref: string; ad_soyad: string; sahip: string; amac: string; anahtar_turu: string; anahtar_bitis: string; calisma_zamani: string; entegrasyon: string | null; durum: string; askiya_alma_nedeni: string | null };
  const [v, setV] = useState<{ kayitlar: H[]; kayitsiz: { kimlik: string; ad_soyad: string }[] } | null>(null); const [m, setM] = useState('');
  const bos = { hesap: '', sahipRol: '', amac: '', eristigiVeri: '', anahtarTuru: 'API Anahtarı', anahtarBitis: '', kaynakAdres: '', calismaZamani: '', kapanisYontemi: '' };
  const [f, setF] = useState(bos);
  const yk = () => istek<NonNullable<typeof v>>('/hizmet-hesabi-envanteri').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const A: [keyof typeof bos, string][] = [['sahipRol', 'Sahip Rol'], ['amac', 'Amaç'], ['eristigiVeri', 'Eriştiği Veri'], ['anahtarBitis', 'Anahtar Bitişi (YYYY-AA-GG)'], ['kaynakAdres', 'Kaynak Adres'], ['calismaZamani', 'Çalışma Zamanı'], ['kapanisYontemi', 'Kapanış Yöntemi']];
  return <><div className="bolum">Hizmet Hesapları</div>{m && <div className="not" role="status">{m}</div>}
    {v.kayitlar.map((x) => <div className={x.durum === 'Aktif' ? 'ozet' : 'hata'} key={x.kullanici_ref}>{x.ad_soyad} · {x.sahip} · {x.amac} · {x.anahtar_turu} (bitiş {tarih(x.anahtar_bitis)}) · {x.calisma_zamani}{x.entegrasyon ? ` · ${x.entegrasyon}` : ''} · {x.durum}{x.askiya_alma_nedeni ? ` · ${x.askiya_alma_nedeni}` : ''}</div>)}
    {v.kayitsiz.length > 0 && <div className="hata">Envantere kaydedilmemiş hizmet hesabı: {v.kayitsiz.map((x) => x.ad_soyad).join(', ')}</div>}
    {v.kayitsiz.length > 0 && <div className="ozet">
      <label htmlFor="hh-h">Hesap</label><select id="hh-h" value={f.hesap} onChange={(e) => setF({ ...f, hesap: e.target.value })}><option value="">Seçiniz</option>{v.kayitsiz.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>
      <label htmlFor="hh-a">Anahtar Türü</label><select id="hh-a" value={f.anahtarTuru} onChange={(e) => setF({ ...f, anahtarTuru: e.target.value })}><option>API Anahtarı</option><option>Sertifika</option></select>
      {A.map(([k, l]) => <div key={k}><label htmlFor={`hh-${k}`}>{l}</label><input id={`hh-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
      <button className="btn2 kucuk" disabled={!f.hesap} onClick={() => void istek('/hizmet-hesabi-envanteri', f).then(() => { setM('Hizmet hesabı envantere kaydedildi.'); setF(bos); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div>}</>;
}

/** YG-510: role göre tekrar sıklığı, sessiz saat ve birleştirme; Kritik bildirim etkilenmez. */
function BildirimKurallari() {
  type K = { rol: string; tekrar_dakika: number | null; sessiz_baslangic: string | null; sessiz_bitis: string | null; birlestir: boolean };
  const [v, setV] = useState<{ roller: string[]; kurallar: K[] } | null>(null); const [m, setM] = useState('');
  const [f, setF] = useState({ rol: '', tekrar: '', bas: '', bit: '', birlestir: false });
  const yk = () => istek<NonNullable<typeof v>>('/bildirim-kurali').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  return <><div className="bolum">Bildirim Kuralları</div>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Kritik bildirimler bu kurallardan etkilenmez.</div>
    {v.kurallar.map((x) => <div className="ozet" key={x.rol}>{x.rol} · Tekrar: {x.tekrar_dakika ? `${x.tekrar_dakika} dk` : '—'} · Sessiz Saat: {x.sessiz_baslangic ? `${x.sessiz_baslangic}–${x.sessiz_bitis}` : '—'} · Birleştirme: {x.birlestir ? 'Evet' : 'Hayır'}</div>)}
    <label htmlFor="bk-r">Rol</label><select id="bk-r" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}><option value="">Seçiniz</option>{v.roller.map((r) => <option key={r}>{r}</option>)}</select>
    <label htmlFor="bk-t">Tekrar Süresi (dakika)</label><input id="bk-t" inputMode="numeric" value={f.tekrar} onChange={(e) => setF({ ...f, tekrar: e.target.value })} />
    <label htmlFor="bk-b">Sessiz Saat Başlangıcı (SS:DD)</label><input id="bk-b" value={f.bas} onChange={(e) => setF({ ...f, bas: e.target.value })} />
    <label htmlFor="bk-s">Sessiz Saat Bitişi (SS:DD)</label><input id="bk-s" value={f.bit} onChange={(e) => setF({ ...f, bit: e.target.value })} />
    <label className="kutu"><input type="checkbox" checked={f.birlestir} onChange={(e) => setF({ ...f, birlestir: e.target.checked })} /><span>Bekleyen İletilerle Birleştir</span></label>
    <button className="btn2 kucuk" disabled={!f.rol} onClick={() => void istek('/bildirim-kurali', { rol: f.rol, tekrarDakika: f.tekrar ? Number(f.tekrar) : null, sessizBaslangic: f.bas || null, sessizBitis: f.bit || null, birlestir: f.birlestir }).then(() => { setM('Bildirim kuralı kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></>;
}

/** YG-1309: başarısız gönderimler; kök neden ve gerekçeyle düzeltilip yeniden çalıştırılır. */
function BasarisizGonderimler() {
  type G = { kimlik: string; kanal: string; konu: string; hedef: string; deneme: number; son_hata: string | null; kok_neden: string | null; dosya_no: string | null; yeniden: number };
  const [v, setV] = useState<{ kokNedenler: string[]; satirlar: G[] } | null>(null); const [m, setM] = useState('');
  const [s, setS] = useState(''); const [f, setF] = useState({ hedef: '', kokNeden: '', gerekce: '' });
  const yk = () => istek<NonNullable<typeof v>>('/gonderim/basarisiz').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  return <><div className="bolum">Başarısız Gönderimler</div>{m && <div className="not" role="status">{m}</div>}{v.satirlar.length === 0 && <div className="ozet bos">Başarısız gönderim bulunmamaktadır.</div>}
    {v.satirlar.map((x) => <div className="hata" key={x.kimlik}>{x.kanal} · {x.konu} · {x.hedef}{x.dosya_no ? ` · ${x.dosya_no}` : ''} · {x.kok_neden ?? 'Kök neden belirlenmedi'}{x.son_hata ? ` · ${x.son_hata}` : ''}{x.yeniden ? ` · ${x.yeniden} kez yeniden çalıştırıldı` : ''}
      {s === x.kimlik ? <div>
        <label htmlFor="bg-h">Hedef (değişmeyecekse boş bırakınız)</label><input id="bg-h" value={f.hedef} onChange={(e) => setF({ ...f, hedef: e.target.value })} />
        <label htmlFor="bg-k">Kök Neden</label><select id="bg-k" value={f.kokNeden} onChange={(e) => setF({ ...f, kokNeden: e.target.value })}><option value="">Seçiniz</option>{v.kokNedenler.map((k) => <option key={k}>{k}</option>)}</select>
        <label htmlFor="bg-g">Gerekçe</label><input id="bg-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
        <button className="btn2 kucuk" disabled={!f.kokNeden || !f.gerekce.trim()} onClick={() => void istek(`/gonderim/${x.kimlik}/yeniden`, f).then(() => { setM('Gönderim yeniden kuyruğa alındı.'); setS(''); setF({ hedef: '', kokNeden: '', gerekce: '' }); return yk(); }).catch((e) => setM(e.message))}>Yeniden Çalıştır</button></div>
        : <> <button className="btn2 kucuk" onClick={() => { setS(x.kimlik); setF({ hedef: '', kokNeden: x.kok_neden ?? '', gerekce: '' }); }}>Düzelt ve Yeniden Çalıştır</button></>}</div>)}</>;
}

/** YG-1316: zamanlanmış işlerin son çalışması; gecikme, çakışma ve hata görünür. */
function ZamanlanmisIsler() {
  type Z = { ad: string; etki: string; son_bitis: string | null; son_sure_ms: number | null; son_hata: string | null; cakisma_sayisi: number; gecikti: boolean };
  const [l, setL] = useState<Z[] | null>(null);
  useEffect(() => { void istek<Z[]>('/zamanlanmis-isler').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <><div className="bolum">Zamanlanmış İşler</div>{l.length === 0 && <div className="ozet bos">Çalışma kaydı bulunmamaktadır.</div>}
    {l.map((x) => <div className={x.gecikti || x.son_hata ? 'hata' : 'ozet'} key={x.ad}>{x.ad} · Son Bitiş: {x.son_bitis ? tarihSaat(x.son_bitis) : '—'}{x.son_sure_ms !== null ? ` · ${(x.son_sure_ms / 1000).toLocaleString('tr-TR')} sn` : ''}{x.gecikti ? ' · Gecikti' : ''}{x.cakisma_sayisi ? ` · Çakışma: ${x.cakisma_sayisi}` : ''}{x.son_hata ? ` · Hata: ${x.son_hata}` : ''}
      {(x.gecikti || x.son_hata) && <div>Etkilenen çıktılar: {x.etki}</div>}</div>)}</>;
}

/** YG-1276, YG-1642, YG-1645: yedek kayıtları, başarısız yedeği olay kaydına bağlama ve geri yükleme testi kaydı. */
function Yedekler() {
  type V = { yedekler: { kimlik: string; tur: string; baslangic: string; durum: string; hata: string | null; satir_sayisi: string | null; olay_no: string | null }[]; testler: { tur: string; sonuc: string; kabul: string | null; zaman: string }[] };
  const [v, setV] = useState<V | null>(null); const [m, setM] = useState('');
  const [f, setF] = useState({ tur: 'Örnek Kayıt', surecSinifi: 'Kritik', iliski: false, butunluk: false, entegrasyon: false, ornekAkis: false, kurtarma: '', kayip: '', kayitTutarli: false, belge: false, yetki: false, not: '' });
  const yk = () => istek<V>('/yedekler').then(setV).catch(() => {});
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (yol: string, g: object, t: (r: any) => string) => void istek(yol, g).then((r) => { setM(t(r)); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Yedekler</div>{m && <div className="not" role="status">{m}</div>}{v.yedekler.length === 0 && <div className="ozet bos">Yedek kaydı bulunmamaktadır.</div>}
    {v.yedekler.slice(0, 20).map((x) => { const sorun = x.durum === 'Başarısız' || x.durum === 'Eksik Set'; return <div className={sorun ? 'hata' : 'ozet'} key={x.kimlik}>{tarihSaat(x.baslangic)} · {x.tur} · {x.durum}{x.hata ? ` · ${x.hata}` : ''}{x.olay_no ? ` · Olay: ${x.olay_no}` : ''}
      {sorun && !x.olay_no && <> <button className="btn2 kucuk" onClick={() => is(`/yedek/${x.kimlik}/olay-bagla`, {}, (r) => `Olay kaydı açıldı: ${r.olayNo}`)}>Olay Kaydına Bağla</button></>}</div>; })}
    <div className="bolum">Geri Yükleme Testleri</div>
    {v.testler.map((x, i) => <div className="ozet" key={i}>{x.tur} · {x.sonuc}{x.kabul ? ` · ${x.kabul}` : ''} · {tarih(x.zaman)}</div>)}
    <div className="ozet">
      <label htmlFor="gy-tur">Test Türü</label><select id="gy-tur" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Örnek Kayıt', 'Tam Sistem', 'Felaket Tatbikatı'].map((d) => <option key={d}>{d}</option>)}</select>
      <label htmlFor="gy-k">Kurtarma Süresi (dakika)</label><input id="gy-k" inputMode="numeric" value={f.kurtarma} onChange={(e) => setF({ ...f, kurtarma: e.target.value })} />
      <label htmlFor="gy-v">Veri Kaybı Süresi (dakika)</label><input id="gy-v" inputMode="numeric" value={f.kayip} onChange={(e) => setF({ ...f, kayip: e.target.value })} />
      <label className="kutu"><input type="checkbox" checked={f.kayitTutarli} onChange={(e) => setF({ ...f, kayitTutarli: e.target.checked })} /><span>Kayıt Sayıları Tutarlı</span></label>
      <label className="kutu"><input type="checkbox" checked={f.belge} onChange={(e) => setF({ ...f, belge: e.target.checked })} /><span>Belgelere Erişiliyor</span></label>
      <label className="kutu"><input type="checkbox" checked={f.yetki} onChange={(e) => setF({ ...f, yetki: e.target.checked })} /><span>Yetkiler Tutarlı</span></label>
      <label className="kutu"><input type="checkbox" checked={f.iliski} onChange={(e) => setF({ ...f, iliski: e.target.checked })} /><span>İlişkiler Tutarlı</span></label>
      <label className="kutu"><input type="checkbox" checked={f.butunluk} onChange={(e) => setF({ ...f, butunluk: e.target.checked })} /><span>Bütünlük Özeti Uyuşuyor</span></label>
      <label className="kutu"><input type="checkbox" checked={f.entegrasyon} onChange={(e) => setF({ ...f, entegrasyon: e.target.checked })} /><span>Entegrasyonlar Çalışıyor</span></label>
      <label className="kutu"><input type="checkbox" checked={f.ornekAkis} onChange={(e) => setF({ ...f, ornekAkis: e.target.checked })} /><span>Örnek İş Akışı Başarılı</span></label>
      <label htmlFor="gy-s">Süreç Sınıfı</label><select id="gy-s" value={f.surecSinifi} onChange={(e) => setF({ ...f, surecSinifi: e.target.value })}>{['Kritik', 'Önemli', 'Destek'].map((d) => <option key={d}>{d}</option>)}</select>
      <label htmlFor="gy-n">Not</label><input id="gy-n" value={f.not} onChange={(e) => setF({ ...f, not: e.target.value })} />
      <button className="btn2 kucuk" disabled={f.kurtarma === '' || f.kayip === ''} onClick={() => is('/geri-yukleme-testi', { ...f, kurtarma: Number(f.kurtarma), kayip: Number(f.kayip) }, (r) => `Test kaydedildi: ${r.sonuc}${f.tur === 'Örnek Kayıt' ? '' : ' · onay kartı açıldı'}`)}>Testi Kaydet</button>
    </div></>;
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
    <ZamanlanmisIsler />
    <BasarisizGonderimler />
    <BildirimKurallari />
    <HizmetHesaplari />
    <UyumGorevleri />
    <VerbisEsik />
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
