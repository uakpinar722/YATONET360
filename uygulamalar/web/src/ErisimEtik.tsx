import { belgeYukle } from './Kalite';
import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; ad_soyad: string; son_giris_zamani: string | null; rol_adi: string; kademe: string; ayricalikli_rol: boolean; karar: string | null; onceki: string | null };
type I = { kimlik: string; donem: string; kapsam: string; kalemler: K[] };
/** YG-1045, YG-1047: erişim incelemesi; rol, görev, son giriş ve önceki karar görünür. */
export function ErisimInceleme() {
  const [l, setL] = useState<I[]>([]); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<I[]>('/erisim-inceleme').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  if (!l.length) return null;
  const is = (id: string, karar: string) => void istek(`/erisim-inceleme/kalem/${id}`, { karar, gerekce: g[id] || undefined, yeniBitis: g[`b${id}`] || undefined }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Erişim İncelemesi</div>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <details key={x.kimlik}><summary>{x.donem} · {x.kapsam} · {x.kalemler.filter((k) => !k.karar).length} bekleyen</summary>{x.kalemler.map((k) => <div className="soru" key={k.kimlik}><span>{k.ad_soyad} · {k.rol_adi} ({k.kademe}){k.ayricalikli_rol ? ' · Ayrıcalıklı' : ''} · Son Giriş: {k.son_giris_zamani ? new Date(k.son_giris_zamani).toLocaleDateString('tr-TR') : 'Yok'}{k.onceki ? ` · Önceki: ${k.onceki}` : ''}{k.karar ? ` · ${k.karar}` : ''}</span>{!k.karar && <div className="tam"><label htmlFor={`ei-${k.kimlik}`}>Gerekçe</label><input id={`ei-${k.kimlik}`} value={g[k.kimlik] ?? ''} onChange={(e) => setG({ ...g, [k.kimlik]: e.target.value })} /><label htmlFor={`eb-${k.kimlik}`}>Yeni Bitiş</label><input id={`eb-${k.kimlik}`} type="date" value={g[`b${k.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`b${k.kimlik}`]: e.target.value })} />{['Koru', 'Daralt', 'Süre Uzat', 'Askıya Al', 'Kapat'].map((d) => <button key={d} className="btn2 kucuk" onClick={() => is(k.kimlik, d)}>{d}</button>)}</div>}</div>)}</details>)}</>;
}

const KAT = ['Etik Bildirim', 'Yönlendirme Komisyonu', 'Suistimal Şüphesi', 'Sosyal Medya', 'Doğrudan Müşteri Talebi'];
type E = { kimlik: string; bildirim_no: string; kategori: string; aciklama: string; durum: string };
/** YG-585, YG-587, YG-1068. */
export function EtikBildirim() {
  const [f, setF] = useState({ kategori: KAT[0]!, aciklama: '' }); const [l, setL] = useState<E[] | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<E[]>('/etik-bildirim').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  const karar = (x: E, yatSahibi?: string) => void istek(`/etik-bildirim/${x.kimlik}/karar`, { sonuc: g[x.kimlik], yatSahibi }).then(() => { setM('Karar kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Bildirimler</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="eb-k">Kategori</label><select id="eb-k" value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })}>{KAT.map((x) => <option key={x}>{x}</option>)}</select><label htmlFor="eb-a">Açıklama</label><input id="eb-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /><button className="btn2 kucuk" disabled={!f.aciklama.trim()} onClick={() => void istek('/etik-bildirim', f).then(() => { setM('Bildiriminiz iletildi.'); setF({ ...f, aciklama: '' }); return yk(); }).catch((e) => setM(e.message))}>Bildir</button>
    {l?.filter((x) => x.durum === 'Açık').map((x) => <div className="soru" key={x.kimlik}><span>{x.bildirim_no} · {x.kategori} · {x.aciklama}</span><div className="tam"><label htmlFor={`es-${x.kimlik}`}>Sonuç</label><input id={`es-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />{['Etik Bildirim', 'Yönlendirme Komisyonu'].includes(x.kategori) ? <><button className="btn2 kucuk" onClick={() => karar(x, 'Bildirilsin')}>Yat Sahibine Bildirilsin</button><button className="btn2 kucuk" onClick={() => karar(x, 'Bildirilmesin')}>Bildirilmesin</button></> : <button className="btn2 kucuk" onClick={() => karar(x)}>Kapat</button>}</div></div>)}</details>;
}

type D = { kimlik: string; denetim_no: string; surec: string; durum: string; vekaleten: boolean; denetci_ref: string; erisim_bitis: string | null; erisim_amaci: string | null; bulgular: { sinif: string; tanim: string }[] | null };
/** YG-1673–1675, YG-1681: iç denetim; rapor yalnız Müdür ve CEO'ya gider. */
export function IcDenetim() {
  const [v, setV] = useState<{ acabilir: boolean; atayabilir?: boolean; denetciler?: { kimlik: string; ad_soyad: string }[]; ben?: string; denetimler: D[] } | null>(null); const [f, setF] = useState({ surec: '', kapsam: '', cikarYok: false, sonOnIkiAyGorevYok: false }); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/ic-denetim').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>İç Denetim</summary>{m && <div className="not" role="status">{m}</div>}
    {v.denetimler.map((d) => <div className="soru" key={d.kimlik}><span>{d.denetim_no} · {d.surec} · {d.durum}{d.vekaleten ? ' · Vekâleten Yürütüldü' : ''}{(d.bulgular ?? []).map((b) => ` · ${b.sinif}: ${b.tanim}`).join('')}</span>{d.durum === 'Açık' && <DenetciAtama d={d} v={v} />}{d.durum === 'Açık' && <div className="tam"><label htmlFor={`id-s-${d.kimlik}`}>Bulgu Sınıfı</label><select id={`id-s-${d.kimlik}`} value={g[`s${d.kimlik}`] ?? 'Gözlem'} onChange={(e) => setG({ ...g, [`s${d.kimlik}`]: e.target.value })}><option>Gözlem</option><option>Minör</option><option>Majör</option><option>Kritik</option></select><label htmlFor={`id-t-${d.kimlik}`}>Bulgu</label><input id={`id-t-${d.kimlik}`} value={g[`t${d.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`t${d.kimlik}`]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/${d.kimlik}/bulgu`, { sinif: g[`s${d.kimlik}`] ?? 'Gözlem', tanim: g[`t${d.kimlik}`] }), 'Bulgu eklendi.')}>Bulgu Ekle</button><label htmlFor={`id-o-${d.kimlik}`}>Rapor Özeti</label><input id={`id-o-${d.kimlik}`} value={g[`o${d.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`o${d.kimlik}`]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/${d.kimlik}/rapor`, { ozet: g[`o${d.kimlik}`] }), 'Rapor gönderildi.')}>Raporu Gönder</button></div>}</div>)}
    {v.acabilir && <><label htmlFor="id-su">Süreç</label><input id="id-su" value={f.surec} onChange={(e) => setF({ ...f, surec: e.target.value })} /><label htmlFor="id-ka">Kapsam</label><input id="id-ka" value={f.kapsam} onChange={(e) => setF({ ...f, kapsam: e.target.value })} /><label><input type="checkbox" checked={f.cikarYok} onChange={(e) => setF({ ...f, cikarYok: e.target.checked })} /> Çıkar çatışmam yoktur</label><label><input type="checkbox" checked={f.sonOnIkiAyGorevYok} onChange={(e) => setF({ ...f, sonOnIkiAyGorevYok: e.target.checked })} /> Son 12 ayda bu süreçte görev almadım</label><button className="btn2 kucuk" onClick={() => is(istek('/ic-denetim', f), 'Denetim açıldı.')}>Denetim Aç</button></>}</details>;
}

/** YG-1679: denetçi ataması (İç Denetim Müdürü) ve atanmış denetçinin süre/amaçla sınırlı salt okunur iz erişimi. */
function DenetciAtama({ d, v }: { d: D; v: { atayabilir?: boolean; denetciler?: { kimlik: string; ad_soyad: string }[]; ben?: string } }) {
  const [f, setF] = useState({ denetci: '', bitis: '', amac: '' }); const [m, setM] = useState(''); const [iz, setIz] = useState<{ olay_zamani: string; eylem: string; sonuc: string; aktor: string | null }[] | null>(null);
  return <div className="tam">{d.erisim_bitis && <div className="not">Erişim bitişi: {d.erisim_bitis.split('-').reverse().join('.')}{d.erisim_amaci ? ` · Amaç: ${d.erisim_amaci}` : ''}</div>}{m && <div className="not" role="status">{m}</div>}
    {v.atayabilir && <><label htmlFor={`da-d-${d.kimlik}`}>Denetçi</label><select id={`da-d-${d.kimlik}`} value={f.denetci} onChange={(e) => setF({ ...f, denetci: e.target.value })}><option value="">Seçiniz</option>{(v.denetciler ?? []).map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>
      <label htmlFor={`da-b-${d.kimlik}`}>Erişim Bitişi</label><input id={`da-b-${d.kimlik}`} type="date" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} />
      <label htmlFor={`da-a-${d.kimlik}`}>Denetim Amacı</label><input id={`da-a-${d.kimlik}`} value={f.amac} onChange={(e) => setF({ ...f, amac: e.target.value })} />
      <button className="btn2 kucuk" disabled={!f.denetci || !f.bitis || !f.amac.trim()} onClick={() => void istek(`/ic-denetim/${d.kimlik}/ata`, f).then(() => setM('Denetçi atandı; erişim açıldı.')).catch((e) => setM(e.message))}>Denetçi Ata</button></>}
    {d.denetci_ref === v.ben && <button className="btn2 kucuk" onClick={() => void istek<NonNullable<typeof iz>>(`/ic-denetim/${d.kimlik}/izler`).then(setIz).catch((e) => setM(e.message))}>İşlem İzlerini Gör</button>}
    {iz && <div className="ozet">{iz.length === 0 ? <div className="not">Kayıt bulunmamaktadır.</div> : iz.map((x, n) => <div key={n}>{new Date(x.olay_zamani).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} · {x.eylem} · {x.sonuc}{x.aktor ? ` · ${x.aktor}` : ''}</div>)}</div>}</div>;
}

/** YG-1642, YG-1646: değişiklik bileti (DGS) açma, izleme ve öncesi/sonrası kanıtıyla kapatma. */
export function DegisiklikBiletleri() {
  type B = { kimlik: string; bilet_no: string; konu: string; gerekce: string; durum: string; kisisel_veri: boolean; zaman: string; benim: boolean };
  const [l, setL] = useState<B[] | null>(null); const [f, setF] = useState<Record<string, string>>({}); const [kv, setKv] = useState(false); const [m, setM] = useState('');
  const [kn, setKn] = useState<Record<string, { oncesi?: File; sonrasi?: File }>>({});
  const yk = () => istek<B[]>('/degisiklik-biletleri').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const ALAN: [string, string][] = [['konu', 'Konu (Sorun)'], ['gerekce', 'Gerekçe'], ['mevcut', 'Mevcut Davranış'], ['beklenen', 'Beklenen Sonuç'], ['talepSahibi', 'Talep Sahibi'], ['etkilenen', 'Etkilenen Kullanıcılar'], ['kabulOlcutu', 'Kabul Ölçütü']];
  const kapat = async (x: B) => { const k = kn[x.kimlik]; if (!k?.oncesi || !k.sonrasi) return; try { const oncesi = await belgeYukle(k.oncesi, 'Değişiklik Bileti', x.kimlik); const sonrasi = await belgeYukle(k.sonrasi, 'Değişiklik Bileti', x.kimlik); await istek(`/degisiklik-bileti/${x.kimlik}/kapat`, { oncesi, sonrasi }); setM(`${x.bilet_no} kapatıldı.`); await yk(); } catch (e) { setM((e as Error).message); } };
  return <details><summary>Değişiklik Biletleri (DGS) · {l.filter((x) => x.durum !== 'Kapalı').length} açık</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div className="soru" key={x.kimlik}><span><b>{x.bilet_no}</b> · {x.konu} · {x.durum === 'Onayda' ? 'Bilgi İşlem Müdürü Kontrolünde' : x.durum}{x.kisisel_veri ? ' · Kişisel Veri' : ''}</span>
      {x.benim && x.durum === 'Onaylandı' && <div className="tam"><label htmlFor={`dg-o-${x.kimlik}`}>Öncesi Kanıtı</label><input id={`dg-o-${x.kimlik}`} type="file" onChange={(e) => setKn({ ...kn, [x.kimlik]: { ...kn[x.kimlik], oncesi: e.target.files?.[0] } })} />
        <label htmlFor={`dg-s-${x.kimlik}`}>Sonrası Kanıtı</label><input id={`dg-s-${x.kimlik}`} type="file" onChange={(e) => setKn({ ...kn, [x.kimlik]: { ...kn[x.kimlik], sonrasi: e.target.files?.[0] } })} />
        <button className="btn2 kucuk" disabled={!kn[x.kimlik]?.oncesi || !kn[x.kimlik]?.sonrasi} onClick={() => void kapat(x)}>Bileti Kapat</button></div>}</div>)}
    <div className="bolum">Yeni Değişiklik Bileti</div>
    {ALAN.map(([k, et]) => <span key={k}><label htmlFor={`dg-${k}`}>{et}</label><input id={`dg-${k}`} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></span>)}
    <label><input type="checkbox" checked={kv} onChange={(e) => setKv(e.target.checked)} /> Kişisel veriye dokunuyor</label>
    {kv && <span><label htmlFor="dg-vs">Veri Sahibi Rol</label><input id="dg-vs" value={f.veriSahibiRol ?? ''} onChange={(e) => setF({ ...f, veriSahibiRol: e.target.value })} /></span>}
    <button className="btn2 kucuk" disabled={ALAN.some(([k]) => !(f[k] ?? '').trim()) || (kv && !(f.veriSahibiRol ?? '').trim())} onClick={() => void istek<{ biletNo: string }>('/degisiklik-bileti', { ...f, kisiselVeri: kv }).then((r) => { setM(`${r.biletNo} Bilgi İşlem Müdürü onayına gönderildi.`); setF({}); setKv(false); return yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></details>;
}

/** YG-1652: Sistem Öz Denetimi; çalışmalar, senaryo sonuçları ve bulgular. Sürüm öncesi ve kural değişikliği sonrası çalışma elle başlatılır. */
export function OzDenetim() {
  type S = { senaryo_kodu: string; surec: string; ad: string; senaryo_turu: string; beklenen: string; gerceklesen: string; basarili: boolean; bulgu_no: string | null };
  type C = { kimlik: string; calisma_no: string; tur: string; sonuc: string; aciklama: string | null; baslangic: string; surum: string | null; sonuclar: S[] };
  const [v, setV] = useState<{ calismalar: C[]; setler: { kimlik: string; surum: string; ortam: string }[]; havuz: number; sabit: string[] } | null>(null);
  const [tur, setTur] = useState(''); const [ys, setYs] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/oz-denetim').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const zaman = (z: string) => new Date(z).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
  return <details><summary>Sistem Öz Denetimi · Havuz {v.havuz} senaryo{v.sabit.length ? ` · Sabit set ${v.sabit.length}` : ''}</summary>{m && <div className="not" role="status">{m}</div>}
    {v.calismalar.length === 0 && <div className="not">Öz denetim çalışması bulunmamaktadır.</div>}
    {v.calismalar.map((c) => <div className="ozet" key={c.kimlik}><div><b>{c.calisma_no}</b> · {c.tur}{c.surum ? ` · ${c.surum}` : ''} · {zaman(c.baslangic)} · <span className={c.sonuc === 'Başarılı' ? 'rozet yesil' : c.sonuc === 'Sürüyor' ? 'rozet gri' : 'rozet kirmizi'}>{c.sonuc}</span>{c.aciklama ? ` · ${c.aciklama}` : ''}</div>
      {c.sonuclar.map((s) => <div key={s.senaryo_kodu} className="not">{s.basarili ? '✓' : '✗'} {s.senaryo_kodu} · {s.surec} · {s.ad} · Beklenen: {s.beklenen} · Gerçekleşen: {s.gerceklesen}{s.bulgu_no ? ` · Bulgu: ${s.bulgu_no}` : ''}</div>)}</div>)}
    <div className="bolum">Öz Denetim Başlat</div>
    <label htmlFor="od-t">Çalışma Türü</label><select id="od-t" value={tur} onChange={(e) => setTur(e.target.value)}><option value="">Seçiniz</option><option>Sürüm Öncesi</option><option>Kural Değişikliği</option></select>
    {tur === 'Sürüm Öncesi' && <><label htmlFor="od-y">Yayın Seti</label><select id="od-y" value={ys} onChange={(e) => setYs(e.target.value)}><option value="">Seçiniz</option>{v.setler.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.surum} · {x.ortam}</option>)}</select></>}
    <button className="btn2 kucuk" disabled={!tur || (tur === 'Sürüm Öncesi' && !ys)} onClick={() => void istek<{ calismaNo: string }>('/oz-denetim', { tur, yayin: ys || undefined }).then((r) => { setM(`${r.calismaNo} başlatıldı; sonuç birkaç dakika içinde listelenir.`); return yk(); }).catch((e) => setM(e.message))}>Öz Denetimi Başlat</button></details>;
}
