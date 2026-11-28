import { useEffect, useState } from 'react';
import { istek } from './api';

const saat = (x: string) => new Date(x).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
const gun = (x: string) => x.split('-').reverse().join('.');

type EksperAna = {
  eksper: boolean; unvan?: string | null; sirketler?: string[];
  davetler?: { kimlik: string; no: string; nokta_turu: string; kontrol_ozelligi: string; planlanan_zaman: string; dosya_no: string; konum: string | null; hasar_no: string | null; yanit: string | null }[];
  parcalar?: { dosya: string; dosya_no: string; konum: string | null; hasar_no: string | null; parca: number; son_tarih: string; randevu: { durum: string; istenen: string; planlanan: string | null } | null }[];
};

/** YG-1570 (A5): bağımsız Sigorta Eksperinin ekranı; davet yanıtı, parça incelemesi randevusu ve isteğe bağlı ekspertiz raporu. */
export function EksperBolumu({ dosyalar }: { dosyalar: { kimlik: string; ad: string }[] }) {
  const [v, setV] = useState<EksperAna | null>(null); const [m, setM] = useState(''); const [z, setZ] = useState<Record<string, string>>({}); const [rd, setRd] = useState('');
  const yk = () => istek<EksperAna>('/eksper/ana').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v?.eksper) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); setZ({}); return yk(); }).catch((e) => setM((e as Error).message));
  const raporYukle = async (f: File) => {
    const q = new URLSearchParams({ ad: 'Ekspertiz Raporu', tur: 'Ekspertiz Raporu', bagTuru: 'Dosya', bagKimligi: rd, kaynak: 'Sistem', dosya: f.name });
    const r = await fetch(`/api/belge/yukle?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Yatonet': '1' }, body: f, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.hata ?? 'Yükleme tamamlanamadı.');
  };
  return <>
    <div className="not">{v.unvan ? `${v.unvan} · ` : ''}Sigorta Eksperi{v.sirketler?.length ? ` · ${v.sirketler.join(', ')}` : ''}</div>
    {m && <div className="not" role="status">{m}</div>}
    <div className="bolum">Yanıt Bekleyen Davetler</div>
    {!v.davetler?.length && <div className="ozet bos">Yanıt bekleyen davet bulunmamaktadır.</div>}
    {v.davetler?.map((x) => <div className="ozet" key={x.kimlik}><b>{x.nokta_turu} Noktası Daveti · {saat(x.planlanan_zaman)}</b>
      <div className="not">{x.konum ? `${x.konum} · ` : ''}{x.hasar_no ? `Hasar Dosya No: ${x.hasar_no} · ` : ''}LGM Dosya No: {x.dosya_no} · İş: {x.kontrol_ozelligi}</div>
      <div className="not">Katılmamanız hâlinde bu aşama fotoğraf ve video kaydıyla belgelenerek ilerleyecektir.{x.yanit ? ` · Yanıtınız: ${x.yanit}` : ''}</div>
      <div className="dugmeler"><button className="btn2 kucuk" onClick={() => is(istek(`/eksper/davet/${x.kimlik}/yanit`, { yanit: 'Katılacağım' }), 'Katılım durumunuz kaydedildi.')}>Katılacağım</button>
        <button className="btn2 kucuk" onClick={() => is(istek(`/eksper/davet/${x.kimlik}/yanit`, { yanit: 'Katılmayacağım' }), 'Katılım durumunuz kaydedildi.')}>Katılmayacağım</button></div></div>)}
    <div className="bolum">Parça İncelemesi</div>
    {!v.parcalar?.length && <div className="ozet bos">İncelemeniz için bekletilen parça bulunmamaktadır.</div>}
    {v.parcalar?.map((x) => <div className="ozet" key={x.dosya}><b>{x.parca} parça · Son: {gun(x.son_tarih)}</b>
      <div className="not">{x.konum ? `${x.konum} · ` : ''}{x.hasar_no ? `Hasar Dosya No: ${x.hasar_no} · ` : ''}LGM Dosya No: {x.dosya_no}</div>
      <div className="not">Sökülen parçalar incelemeniz için bekletilmektedir.</div>
      {x.randevu && <div className="not">Randevu: {x.randevu.durum === 'Planlandı' && x.randevu.planlanan ? `${saat(x.randevu.planlanan)} · Planlandı` : `${saat(x.randevu.istenen)} · Talep Edildi`}</div>}
      {x.randevu?.durum !== 'Talep Edildi' && <><label htmlFor={`er-${x.dosya}`}>İstenen Tarih ve Saat</label><input id={`er-${x.dosya}`} type="datetime-local" value={z[x.dosya] ?? ''} onChange={(e) => setZ({ ...z, [x.dosya]: e.target.value })} />
        <label htmlFor={`en-${x.dosya}`}>Not</label><input id={`en-${x.dosya}`} value={z[`n${x.dosya}`] ?? ''} onChange={(e) => setZ({ ...z, [`n${x.dosya}`]: e.target.value })} />
        <button className="btn2 kucuk" disabled={!z[x.dosya]} title="Gönderilecek: Dosya Sorumlusu" onClick={() => is(istek(`/eksper/dosya/${x.dosya}/randevu`, { zaman: new Date(z[x.dosya]!).toISOString(), not: z[`n${x.dosya}`] }), 'Randevu talebiniz Dosya Sorumlusuna iletildi.')}>İnceleme Randevusu Talep Et</button></>}</div>)}
    <div className="bolum">Ekspertiz Raporu</div>
    <div className="not">Ekspertiz raporunuzu paylaşmak isterseniz yükleyebilirsiniz.</div>
    <label htmlFor="ek-d">Dosya</label><select id="ek-d" value={rd} onChange={(e) => setRd(e.target.value)}><option value="">Seçiniz</option>{dosyalar.map((d) => <option key={d.kimlik} value={d.kimlik}>{d.ad}</option>)}</select>
    <label htmlFor="ek-r">Ekspertiz Raporu Yükle</label><input id="ek-r" type="file" accept=".pdf" disabled={!rd} onChange={(e) => { const f = e.target.files?.[0]; if (f) is(raporYukle(f), 'Ekspertiz raporunuz yüklendi; Dosya Sorumlusu bilgilendirildi.'); }} />
  </>;
}

type DosyaEksper = {
  eksperler: { kimlik: string; ad: string; unvan: string | null; eposta: string; hesap_durumu: string | null }[];
  randevular: { kimlik: string; eksper: string; istenen_zaman: string; not_metni: string | null; durum: string; planlanan_zaman: string | null }[];
  yanitlar: { kontrol_noktasi_no: string; planlanan_zaman: string; eksper: string; yanit: string; zaman: string }[];
};

/** YG-1570: Dosya Sorumlusu dosyaya Sigorta Eksperini ekler; davet yanıtlarını ve parça incelemesi randevu taleplerini görür, randevuyu planlar. */
export function DosyaEksperi({ id }: { id: string }) {
  const [v, setV] = useState<DosyaEksper | null>(null); const [f, setF] = useState({ ad: '', eposta: '', telefon: '', unvan: '' }); const [p, setP] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<DosyaEksper>(`/dosya/${id}/eksper`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [id]);
  if (!v) return null;
  const is = (x: Promise<unknown>, t: string) => void x.then(() => { setM(t); return yk(); }).catch((e) => setM((e as Error).message));
  const al = (k: keyof typeof f, et: string) => <><label htmlFor={`de-${k}`}>{et}</label><input id={`de-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <details><summary>Sigorta Eksperi</summary>{m && <div className="not" role="status">{m}</div>}
    {v.eksperler.map((x) => <div className="ozet" key={x.kimlik}><b>{x.ad}</b><div className="not">{x.unvan ? `${x.unvan} · ` : ''}{x.eposta}{x.hesap_durumu ? ` · Hesap: ${x.hesap_durumu}` : ''}</div></div>)}
    {al('ad', 'Ad Soyad')}{al('unvan', 'Eksper veya Eksper Şirketi Unvanı')}{al('eposta', 'E-posta')}{al('telefon', 'Cep Telefonu')}
    <button className="btn2 kucuk" disabled={!f.ad.trim() || !f.eposta.trim()} onClick={() => is(istek(`/dosya/${id}/eksper`, f).then((r) => { setF({ ad: '', eposta: '', telefon: '', unvan: '' }); return r; }), 'Eksper dosyaya eklendi.')}>Eksperi Ekle</button>
    {v.yanitlar.length > 0 && <><div className="bolum">Davet Yanıtları</div>{v.yanitlar.map((x, n) => <div key={n}>{x.kontrol_noktasi_no} · {saat(x.planlanan_zaman)} · {x.eksper}: {x.yanit}</div>)}</>}
    {v.randevular.length > 0 && <><div className="bolum">Parça İncelemesi Randevuları</div>{v.randevular.map((x) => <div className="ozet" key={x.kimlik}><b>{x.eksper} · İstenen: {saat(x.istenen_zaman)}</b><div className="not">{x.durum}{x.planlanan_zaman ? ` · ${saat(x.planlanan_zaman)}` : ''}{x.not_metni ? ` · ${x.not_metni}` : ''}</div>
      {x.durum === 'Talep Edildi' && <><label htmlFor={`rp-${x.kimlik}`}>Randevu Tarihi ve Saati</label><input id={`rp-${x.kimlik}`} type="datetime-local" value={p[x.kimlik] ?? ''} onChange={(e) => setP({ ...p, [x.kimlik]: e.target.value })} />
        <button className="btn2 kucuk" disabled={!p[x.kimlik]} onClick={() => is(istek(`/eksper-randevu/${x.kimlik}/planla`, { zaman: new Date(p[x.kimlik]!).toISOString() }), 'Randevu kaydedildi; eksper bilgilendirildi.')}>Randevuyu Kaydet</button></>}</div>)}</>}
  </details>;
}
