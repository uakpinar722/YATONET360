import { useEffect, useState } from 'react';
import { istek } from './api';

/** YG-948: talep ekranında yıllık izin hakkı ve kalan bakiye. */
export function IzinBakiyesi() {
  const [v, setV] = useState<{ yil: number; hak: number; kullanilan: number; kalan: number } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/izin/bakiye').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  return <div className="not">{v.yil} yıllık izin hakkı: {v.hak} gün · Kullanılan: {v.kullanilan} gün · Kalan: {v.kalan} gün</div>;
}

/** YG-922: Saha Sorumlusu dışındaki personel özel araç kullanımını yolculuktan önce birim amirinin onayına sunar. */
export function OzelAracOnayi() {
  const [f, setF] = useState({ tarih: '', guzergah: '', gerekce: '' }); const [m, setM] = useState('');
  return <><div className="bolum">Özel Araç Kullanımı Ön Onayı</div><div className="ozet">{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="oa-t">Yolculuk Tarihi</label><input id="oa-t" type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} />
    <label htmlFor="oa-g">Güzergâh</label><input id="oa-g" value={f.guzergah} onChange={(e) => setF({ ...f, guzergah: e.target.value })} />
    <label htmlFor="oa-r">Gerekçe</label><input id="oa-r" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
    <button className="btn2" disabled={!f.tarih || !f.guzergah.trim() || !f.gerekce.trim()} onClick={() => void istek('/ozel-arac-onayi', f).then(() => { setM('Talebiniz birim amirinizin onayına gönderildi.'); setF({ tarih: '', guzergah: '', gerekce: '' }); }).catch((e) => setM(e.message))}>Onaya Gönder</button></div></>;
}

/** YG-976: personel istifasını kendisi bildirir; bildirim zamanı kayda geçer, İnsan Kaynaklarına görev düşer. */
export function IstifaBildirimi() {
  const [f, setF] = useState({ sonGun: '', aciklama: '' }); const [m, setM] = useState(''); const [ac, setAc] = useState(false);
  return <details className="ozet" open={ac} onToggle={(e) => setAc((e.target as HTMLDetailsElement).open)}><summary>İstifa Bildirimi</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Bildiriminizin zamanı kayda geçer ve İnsan Kaynaklarına iletilir. Ayrılış işlemleri için imzalı istifa dilekçeniz İnsan Kaynaklarınca ayrıca alınır.</div>
    <label htmlFor="is-s">İstenen Son İş Günü</label><input id="is-s" type="date" value={f.sonGun} onChange={(e) => setF({ ...f, sonGun: e.target.value })} />
    <label htmlFor="is-a">Açıklama</label><input id="is-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
    <button className="btn hayir" onClick={() => void istek('/istifa-bildirimi', { sonGun: f.sonGun || undefined, aciklama: f.aciklama || undefined }).then(() => { setM('İstifa bildiriminiz İnsan Kaynaklarına iletildi.'); setF({ sonGun: '', aciklama: '' }); }).catch((e) => setM(e.message))}>İstifamı Bildir</button></details>;
}

/** YG-946: evlilik, doğum ve vefat haberi yalnız çalışanın kendi talebiyle LGM personeline duyurulur. */
export function HaberDuyurusu() {
  const [f, setF] = useState({ tur: 'Evlilik', aciklama: '' }); const [m, setM] = useState('');
  return <details className="ozet"><summary>Haberimi Duyur</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Haberiniz yalnız sizin talebinizle ve yalnız LGM personeline 7 gün süreyle duyurulur.</div>
    <label htmlFor="hd-t">Haber Türü</label><select id="hd-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Evlilik', 'Doğum', 'Vefat'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="hd-a">Paylaşmak İstediğiniz Not</label><input id="hd-a" maxLength={500} value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
    <button className="btn2" onClick={() => void istek('/haber-duyurusu', { tur: f.tur, aciklama: f.aciklama || undefined }).then(() => { setM('Haberiniz duyuruldu.'); setF({ tur: 'Evlilik', aciklama: '' }); }).catch((e) => setM(e.message))}>Duyur</button></details>;
}
