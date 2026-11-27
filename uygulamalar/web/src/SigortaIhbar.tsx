import { useEffect, useState } from 'react';
import { istek } from './api';

const BOS = { hasarNo: '', policeNo: '', yatAdi: '', konum: '', ozet: '', sahipAd: '', sahipTel: '', yetkili: '', hizmet: '', yetkiSiniri: '', onayKanali: 'YATONET 360' };

/** YG-438, YG-446: sigorta şirketi kullanıcısının hasar ihbarı (Sigorta Görevlendirmesi); hasar dosya no zorunlu, poliçe no isteğe bağlı. */
export function SigortaIhbar({ sonra }: { sonra: () => void }) {
  const [f, setF] = useState(BOS); const [m, setM] = useState(''); const [ac, setAc] = useState(false);
  const A = (k: keyof typeof BOS, et: string) => <><label htmlFor={`si-${k}`}>{et}</label><input id={`si-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <details className="ozet" open={ac} onToggle={(e) => setAc((e.target as HTMLDetailsElement).open)}><summary>Hasar İhbarı / Görevlendirme</summary>{m && <div className="not" role="status">{m}</div>}
    {A('hasarNo', 'Hasar Dosya No')}{A('policeNo', 'Poliçe No (Varsa)')}{A('yatAdi', 'Yat Adı')}{A('konum', 'Yatın Bulunduğu Yer')}
    <label htmlFor="si-ozet">Olay Özeti</label><textarea required id="si-ozet" value={f.ozet} onChange={(e) => setF({ ...f, ozet: e.target.value })} />
    {A('hizmet', 'İstenen Hizmet')}{A('yetkili', 'Dosya Yetkilisi (Ad, Telefon)')}
    <label htmlFor="si-ys">Dosya Yetkilisinin Yetki Sınırı (EUR, Varsa)</label><input id="si-ys" inputMode="decimal" value={f.yetkiSiniri} onChange={(e) => setF({ ...f, yetkiSiniri: e.target.value })} />
    <label htmlFor="si-ok">Onay Kanalı</label><select id="si-ok" value={f.onayKanali} onChange={(e) => setF({ ...f, onayKanali: e.target.value })}><option>YATONET 360</option><option>Sözleşmede Tanımlı Kurumsal E-posta</option></select>
    {A('sahipAd', 'Yat Sahibi Adı (Varsa)')}{A('sahipTel', 'Yat Sahibi Telefonu (Varsa)')}
    <button className="btn2" disabled={!f.hasarNo.trim() || !f.yatAdi.trim() || !f.konum.trim() || !f.ozet.trim()} onClick={() => void istek<{ talepNo: string }>('/sigorta/gorevlendirme', { ...f, yetkiSiniri: f.yetkiSiniri ? Number(f.yetkiSiniri.replace(/\./g, '').replace(',', '.')) : undefined }).then((r) => { setM(`İhbarınız ${r.talepNo} numarasıyla alındı.`); setF(BOS); sonra(); }).catch((e) => setM(e.message))}>İhbarı Gönder</button></details>;
}

type Rapor = { kimlik: string; donem: string; kesim_tarihi: string; itiraz_son: string | null; durum: string; satirlar: { kimlik: string; dosya_no: string; fatura_no: string; acik_bakiye: string; itiraz_edildi: boolean; mutabik: boolean }[] };
/** YG-1571: Raporlar; aylık mutabakat raporu ve itiraz süresi içinde satır bazında "İtiraz Et". */
export function SigortaMutabakat() {
  const [l, setL] = useState<Rapor[] | null>(null); const [n, setN] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<Rapor[]>('/sigorta/mutabakat').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const bugun = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  return <details className="ozet"><summary>Raporlar · Aylık Mutabakat</summary>{m && <div className="not" role="status">{m}</div>}
    {l.length === 0 ? <div className="not">Gönderilmiş mutabakat raporu bulunmamaktadır.</div> : l.map((r) => <div key={r.kimlik}><b>{r.donem} · {r.durum}{r.itiraz_son ? ` · İtiraz Son: ${r.itiraz_son.split('-').reverse().join('.')}` : ''}</b>
      {r.satirlar.map((s) => <div key={s.kimlik} className="soru"><span>{s.dosya_no} · {s.fatura_no} · Açık Bakiye: {Number(s.acik_bakiye).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR{s.itiraz_edildi ? ' · İtiraz Edildi' : ''}{s.mutabik ? ' · Mutabık' : ''}</span>
        {!s.itiraz_edildi && !s.mutabik && r.itiraz_son && r.itiraz_son >= bugun && <div className="tam"><label htmlFor={`sm-${s.kimlik}`}>İtiraz Notu</label><input id={`sm-${s.kimlik}`} value={n[s.kimlik] ?? ''} onChange={(e) => setN({ ...n, [s.kimlik]: e.target.value })} />
          <button className="btn hayir" disabled={!(n[s.kimlik] ?? '').trim()} onClick={() => void istek(`/mutabakat-satiri/${s.kimlik}/itiraz`, { not: n[s.kimlik] }).then(() => { setM('İtirazınız kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>İtiraz Et</button></div>}</div>)}</div>)}</details>;
}

/** YG-446: sigorta kullanıcısı dosyadaki talimat değişikliğini portaldan bildirir; Talimat ve Karar Kayıtlarına yetkili kaynak olarak düşer. */
export function SigortaTalimat({ dosyalar }: { dosyalar: { kimlik: string; ad: string }[] }) {
  const [d, setD] = useState(''); const [x, setX] = useState(''); const [m, setM] = useState('');
  if (!dosyalar.length) return null;
  return <details><summary>Talimat Değişikliği Bildir</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="st-d">Dosya</label><select id="st-d" value={d} onChange={(e) => setD(e.target.value)}><option value="">Seçiniz</option>{dosyalar.map((z) => <option key={z.kimlik} value={z.kimlik}>{z.ad}</option>)}</select>
    <label htmlFor="st-m">Talimat Değişikliği</label><textarea id="st-m" rows={2} value={x} onChange={(e) => setX(e.target.value)} />
    <button className="btn2 kucuk" disabled={!d || !x.trim()} onClick={() => void istek(`/sigorta/dosya/${d}/talimat-degisikligi`, { metin: x }).then(() => { setM('Talimat değişikliğiniz iletildi.'); setX(''); }).catch((e) => setM(e.message))}>Gönder</button></details>;
}

/** YG-446: şirketteki bir kullanıcının hesabının kapatılması talebi; Müşteri ve Paydaş İlişkileri Müdürü değerlendirir. */
export function SigortaKullaniciKapatma() {
  const [l, setL] = useState<{ kimlik: string; ad_soyad: string }[]>([]); const [f, setF] = useState({ kullanici: '', gerekce: '' }); const [m, setM] = useState('');
  useEffect(() => { void istek<{ kullanicilar: { kimlik: string; ad_soyad: string }[] }>('/sigorta/kullanicilarim').then((r) => setL(r.kullanicilar)).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <details><summary>Kullanıcı Hesabı Kapatma Talebi</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="sk-k">Kullanıcı</label><select id="sk-k" value={f.kullanici} onChange={(e) => setF({ ...f, kullanici: e.target.value })}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>
    <label htmlFor="sk-g">Gerekçe</label><input id="sk-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.kullanici || !f.gerekce.trim()} onClick={() => void istek('/sigorta/kullanici-kapatma-talebi', f).then(() => { setM('Talebiniz iletildi.'); setF({ kullanici: '', gerekce: '' }); }).catch((e) => setM(e.message))}>Talep Gönder</button></details>;
}
