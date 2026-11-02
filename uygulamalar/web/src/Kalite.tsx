import { useEffect, useState, type ReactNode } from 'react';
import { istek } from './api';

export async function belgeYukle(f: File, bagTuru: string, bagKimligi: string): Promise<string> {
  const q = new URLSearchParams({ ad: f.name, tur: bagTuru === 'İş Emri' ? 'İş Emri Kanıtı' : 'Dosya Belgesi', bagTuru, bagKimligi, kaynak: 'Elden', dosya: f.name });
  const r = await fetch(`/api/belge/yukle?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Yatonet': '1' }, body: f, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.hata ?? 'Yükleme tamamlanamadı.');
  return j.belge;
}

/** Kanıt seçimi: kullanıcı dosya seçer, sistem kimliği tutar; kullanıcıya kimlik gösterilmez. */
export function BelgeSec({ ad, bagTuru, bagKimligi, deger, sec }: { ad: string; bagTuru: string; bagKimligi: string; deger: string; sec: (x: string) => void }) {
  const [h, setH] = useState('');
  const kimlik = `b-${ad.replace(/\s/g, '')}-${bagKimligi.slice(0, 6)}`;
  return (
    <>
      <label htmlFor={kimlik}>{ad}</label>
      <input id={kimlik} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setH(''); void belgeYukle(f, bagTuru, bagKimligi).then(sec).catch((x) => setH((x as Error).message)); } }} />
      {deger && <div className="not">Dosya yüklendi.</div>}
      {h && <div className="hata" role="alert">{h}</div>}
    </>
  );
}

const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;
const SINIF = ['Kritik', 'Majör', 'Minör', 'Gözlem'];
const KAYNAK = ['Saha gözlemi', 'Ölçüm', 'Ara kontrol', 'Test', 'Doküman incelemesi', 'Malzeme kabulü', 'Taraf bildirimi'];
const TASARRUF = ['Olduğu Gibi Kabul', 'Düzeltme', 'Yeniden İşleme', 'Ayırma/Karantina', 'İade/Değişim', 'Ret/Hurda'];
const GRUP = ['Gövde ve Yapısal', 'Makine ve Tahrik', 'Elektrik/Elektronik', 'Tesisat ve Yardımcı', 'Seyir ve Haberleşme', 'İç Mekân ve Donanım', 'Arayüz / Bütünleşik'];
const SONUC = ['Başarılı', 'Koşullu', 'Başarısız', 'Geçersiz', 'Engellendi'];
const KM = 'Kalite Müdürü'; const KK = 'Kalite Uzmanı (Kalite Kontrolör)';

interface KaliteV {
  planlar: { kimlik: string; surum: number; kabul_sinifi: string; ozet: string; durum: string }[];
  gereklilikler: { kimlik: string; gereklilik: string; dogrulama: string; durum: string }[];
  uygunsuzluklar: { kimlik: string; uygunsuzluk_no: string; sinif: string; emniyet_isareti: boolean; gercek_durum: string; tasarruf_karari: string | null; statu: string; firma_yaniti: string | null }[];
  kontrolNoktalari: { kimlik: string; kontrol_noktasi_no: string; nokta_turu: string; kontrol_ozelligi: string; sonuc: string | null; serbest_birakma_zamani: string | null }[];
  testler: { kimlik: string; test_no: string; test_grubu: string; kabul_olcutu: string; sonuc: string | null; durum: string }[];
  acikIsler: { kimlik: string; tanim: string; hedef_tarih: string; kapanis_zamani: string | null }[];
}

/** YG-288, YG-283, YG-286, YG-383, YG-401: dosya içinde kalite planı, uygunsuzluk, kontrol noktası, test ve nihai kabul. */
export function KaliteBolumu({ id, roller }: { id: string; roller: string[] }) {
  const [v, setV] = useState<KaliteV | null>(null); const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  const yukle = () => istek<KaliteV>(`/dosya/${id}/kalite`).then(setV);
  useEffect(() => { void yukle().catch((e) => setHata((e as Error).message)); }, [id]);
  const yap = async (f: () => Promise<unknown>, tamam?: string) => { setHata(''); setNot(''); try { await f(); if (tamam) setNot(tamam); await yukle(); } catch (x) { setHata((x as Error).message); } };
  const [p, setP] = useState({ sinif: 'C', ozet: '', gereklilik: '', dogrulama: '' });
  const [n, setN] = useState({ kaynak: KAYNAK[0]!, yer: '', olcut: '', durum: '', sinif: 'Minör', emniyet: false, belge: '' });
  const [ks, setKs] = useState<Record<string, { karar: string; kanit: string }>>({});
  const [kn, setKn] = useState({ problem: '', dogrudan: '', katki: '', bariyer: '', kokNeden: '', tekrar: '' });
  const [t, setT] = useState({ grup: GRUP[0]!, amac: '', yontem: '', olcut: '', durdurma: '' });
  const [ts, setTs] = useState<Record<string, { sonuc: string; gerekce: string; ham: string }>>({});
  const [gk, setGk] = useState<Record<string, string>>({});
  if (!v) return null;
  const kalite = roller.includes(KM) || roller.includes(KK);
  const teknik = roller.some((r) => ['Teknik Uzman', 'Teknik Yönetici', 'Teknik Müdür', 'Sorumlu Teknik Uzman (Koordinatör)', 'Saha Sorumlusu'].includes(r));
  return (
    <>
      {hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}
      <Blok baslik="Kalite Planı">
        {v.planlar.length === 0 && <div className="not">Onaylı kalite planı olmadan onarım işi başlatılamaz.</div>}
        {v.planlar.map((x) => <div key={x.kimlik}>Rev.{x.surum} · {x.kabul_sinifi} Sınıfı · {x.durum}</div>)}
        {v.gereklilikler.map((g) => <div className="soru" key={g.kimlik}><span>{g.gereklilik} · {g.dogrulama} · {g.durum}</span>{g.durum !== 'Karşılandı' && teknik && <>
          <BelgeSec ad="Gereklilik Kanıtı" bagTuru="Dosya" bagKimligi={id} deger={gk[g.kimlik] ?? ''} sec={(k) => setGk({ ...gk, [g.kimlik]: k })} />
          <button className="btn2 kucuk" disabled={!gk[g.kimlik]} onClick={() => void yap(() => istek(`/gereklilik/${g.kimlik}/kanit`, { belge: gk[g.kimlik], durum: 'Karşılandı' }))}>Karşılandı</button></>}</div>)}
        {teknik && <>
          <label htmlFor="p-s">Kabul Sınıfı</label><select id="p-s" value={p.sinif} onChange={(e) => setP({ ...p, sinif: e.target.value })}>{['A', 'B', 'C', 'D'].map((x) => <option key={x}>{x}</option>)}</select>
          <label htmlFor="p-o">Plan Özeti</label><input id="p-o" value={p.ozet} onChange={(e) => setP({ ...p, ozet: e.target.value })} />
          <label htmlFor="p-g">Gereklilik</label><input id="p-g" value={p.gereklilik} onChange={(e) => setP({ ...p, gereklilik: e.target.value })} />
          <label htmlFor="p-d">Doğrulama Yöntemi</label><input id="p-d" value={p.dogrulama} onChange={(e) => setP({ ...p, dogrulama: e.target.value })} />
          <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/kalite-plani`, { sinif: p.sinif, ozet: p.ozet, gereklilikler: [{ gereklilik: p.gereklilik, dogrulama: p.dogrulama }] }), 'Kalite planı onaya gönderildi.')}>Kalite Planını Onaya Gönder</button>
        </>}
      </Blok>
      <Blok baslik="Uygunsuzluklar">
        {v.uygunsuzluklar.length === 0 && <div className="not">Uygunsuzluk bulunmamaktadır.</div>}
        {v.uygunsuzluklar.map((u) => { const a = ks[u.kimlik] ?? { karar: 'Düzeltme', kanit: '' }; return (
          <div className="soru" key={u.kimlik}>
            <span>{u.uygunsuzluk_no} · {u.sinif}{u.emniyet_isareti ? ' · Emniyet' : ''} · {u.statu}{u.tasarruf_karari ? ` · ${u.tasarruf_karari}` : ''}</span>
            <div>{u.gercek_durum}</div>{u.firma_yaniti && <div>Firma Yanıtı: {u.firma_yaniti}</div>}
            {kalite && u.statu !== 'Kapalı' && <>
              <label htmlFor={`t-${u.kimlik}`}>Teknik Tasarruf</label><select id={`t-${u.kimlik}`} value={a.karar} onChange={(e) => setKs({ ...ks, [u.kimlik]: { ...a, karar: e.target.value } })}>{TASARRUF.filter((x) => u.sinif !== 'Kritik' || x !== 'Olduğu Gibi Kabul').map((x) => <option key={x}>{x}</option>)}</select>
              <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/uygunsuzluk/${u.kimlik}/tasarruf`, { karar: a.karar }))}>Kararı Kaydet</button>
              {(u.sinif === 'Kritik' || u.sinif === 'Majör') && <>
                {(['problem', 'dogrudan', 'katki', 'bariyer', 'kokNeden', 'tekrar'] as const).map((k) => <input key={k} aria-label={{ problem: 'Problem Tanımı', dogrudan: 'Doğrudan Neden', katki: 'Katkı Faktörleri', bariyer: 'Bariyer Analizi', kokNeden: 'Kök Neden', tekrar: 'Tekrar Olasılığı' }[k]} placeholder={{ problem: 'Problem Tanımı', dogrudan: 'Doğrudan Neden', katki: 'Katkı Faktörleri', bariyer: 'Bariyer Analizi', kokNeden: 'Kök Neden', tekrar: 'Tekrar Olasılığı' }[k]} value={kn[k]} onChange={(e) => setKn({ ...kn, [k]: e.target.value })} />)}
                <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/uygunsuzluk/${u.kimlik}/kok-neden`, kn), 'Kök neden kaydedildi.')}>Kök Nedeni Kaydet</button>
              </>}
              <BelgeSec ad="Kapanış Kanıtı" bagTuru="Dosya" bagKimligi={id} deger={a.kanit} sec={(k) => setKs({ ...ks, [u.kimlik]: { ...a, kanit: k } })} />
              <button className="btn2 kucuk" disabled={!a.kanit} onClick={() => void yap(() => istek(`/uygunsuzluk/${u.kimlik}/kapat`, { sonuc: 'Uygun', kanit: a.kanit }))}>Doğrula ve Kapat</button>
            </>}
          </div>
        ); })}
        <label htmlFor="n-k">Tespit Kaynağı</label><select id="n-k" value={n.kaynak} onChange={(e) => setN({ ...n, kaynak: e.target.value })}>{KAYNAK.map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="n-y">Yer ve Nitelik</label><input id="n-y" value={n.yer} onChange={(e) => setN({ ...n, yer: e.target.value })} />
        <label htmlFor="n-o">Dayanak Ölçüt</label><input id="n-o" value={n.olcut} onChange={(e) => setN({ ...n, olcut: e.target.value })} />
        <label htmlFor="n-d">Gerçek Durum</label><input id="n-d" value={n.durum} onChange={(e) => setN({ ...n, durum: e.target.value })} />
        <label htmlFor="n-s">Sınıf</label><select id="n-s" value={n.sinif} onChange={(e) => setN({ ...n, sinif: e.target.value })}>{SINIF.map((x) => <option key={x}>{x}</option>)}</select>
        <label className="kutu"><input type="checkbox" checked={n.emniyet} onChange={(e) => setN({ ...n, emniyet: e.target.checked })} /><span>Emniyeti Etkiliyor</span></label>
        <BelgeSec ad="Uygunsuzluk Kanıtı" bagTuru="Dosya" bagKimligi={id} deger={n.belge} sec={(k) => setN({ ...n, belge: k })} />
        <button className="btn2" disabled={!n.belge} onClick={() => void yap(() => istek(`/dosya/${id}/uygunsuzluk`, n), 'Uygunsuzluk açıldı.')}>Uygunsuzluk Aç</button>
      </Blok>
      <Blok baslik="Kontrol Noktaları">
        {v.kontrolNoktalari.length === 0 && <div className="not">Kontrol noktası bulunmamaktadır.</div>}
        {v.kontrolNoktalari.map((k) => <div key={k.kimlik}>{k.kontrol_noktasi_no} · {k.nokta_turu} · {k.kontrol_ozelligi} · {k.serbest_birakma_zamani ? 'Serbest Bırakıldı' : k.sonuc ?? 'Bekliyor'}</div>)}
      </Blok>
      <Blok baslik="Testler">
        {v.testler.map((x) => { const a = ts[x.kimlik] ?? { sonuc: 'Başarılı', gerekce: '', ham: '' }; return (
          <div className="soru" key={x.kimlik}>
            <span>{x.test_no} · {x.test_grubu} · Ölçüt: {x.kabul_olcutu} · {x.durum}{x.sonuc ? ` · ${x.sonuc}` : ''}</span>
            {x.durum === 'Planlandı' && <>
              <label htmlFor={`ts-${x.kimlik}`}>Sonuç</label><select id={`ts-${x.kimlik}`} value={a.sonuc} onChange={(e) => setTs({ ...ts, [x.kimlik]: { ...a, sonuc: e.target.value } })}>{SONUC.map((s) => <option key={s}>{s}</option>)}</select>
              <label htmlFor={`tg-${x.kimlik}`}>Gerekçe</label><input id={`tg-${x.kimlik}`} value={a.gerekce} onChange={(e) => setTs({ ...ts, [x.kimlik]: { ...a, gerekce: e.target.value } })} />
              <BelgeSec ad="Ham Veri" bagTuru="Dosya" bagKimligi={id} deger={a.ham} sec={(k) => setTs({ ...ts, [x.kimlik]: { ...a, ham: k } })} />
              <button className="btn2 kucuk" disabled={!a.ham} onClick={() => void yap(() => istek(`/test/${x.kimlik}/sonuc`, { sonuc: a.sonuc, gerekce: a.gerekce, hamVeri: a.ham }))}>Sonucu Kaydet</button>
            </>}
            {x.durum === 'Kontrolde' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/test/${x.kimlik}/kontrol`, {}))}>Kontrol Ettim</button>}
            {x.durum === 'Kararda' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/test/${x.kimlik}/karar`, {}))}>Kararı Ver</button>}
          </div>
        ); })}
        {teknik && <>
          <label htmlFor="ts-g">Test Grubu</label><select id="ts-g" value={t.grup} onChange={(e) => setT({ ...t, grup: e.target.value })}>{GRUP.map((x) => <option key={x}>{x}</option>)}</select>
          <label htmlFor="ts-a">Amaç ve Kapsam</label><input id="ts-a" value={t.amac} onChange={(e) => setT({ ...t, amac: e.target.value })} />
          <label htmlFor="ts-y">Yöntem</label><input id="ts-y" value={t.yontem} onChange={(e) => setT({ ...t, yontem: e.target.value })} />
          <label htmlFor="ts-o">Kabul Ölçütü (Test Sonrası Değişmez)</label><input id="ts-o" value={t.olcut} onChange={(e) => setT({ ...t, olcut: e.target.value })} />
          <label htmlFor="ts-d">Durdurma Koşulu</label><input id="ts-d" value={t.durdurma} onChange={(e) => setT({ ...t, durdurma: e.target.value })} />
          <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/test`, t), 'Test planlandı.')}>Testi Planla</button>
        </>}
      </Blok>
      {v.acikIsler.length > 0 && <Blok baslik="Açık İşler">{v.acikIsler.map((x) => <div key={x.kimlik}>{x.tanim} · Hedef: {x.hedef_tarih.split('-').reverse().join('.')} · {x.kapanis_zamani ? 'Kapalı' : 'Açık'}</div>)}</Blok>}
      {(roller.includes(KM) || roller.includes('Teknik Yönetici') || roller.includes('Teknik Müdür')) && <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/nihai-kabul`, {}), 'Nihai kabul kaydedildi; garanti başladı.')}>Nihai Kabul</button>}
    </>
  );
}

/** YG-823, YG-404, YG-1589: tedarik siparişi Tedarik Sorumlusundan onay zincirine gider. */
export function TedarikBolumu({ id, roller }: { id: string; roller: string[] }) {
  const [f, setF] = useState({ tedarikci: '', teklifRef: '', kullanim: '', teslimTarihi: '', teslimYeri: '', olcut: '', gerekce: '', tanim: '', parcaNo: '', miktar: '1', birim: 'adet', bedel: '' });
  const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  if (!roller.includes('Tedarik Sorumlusu')) return null;
  const yaz = (k: keyof typeof f, ad: string, tur = 'text') => <><label htmlFor={`sp-${k}`}>{ad}</label><input id={`sp-${k}`} type={tur} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return (
    <Blok baslik="Tedarik Siparişi">
      {hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}
      {yaz('tedarikci', 'Tedarikçi Sicil Kaydı')}{yaz('teklifRef', 'Tedarikçi Teklif No')}{yaz('kullanim', 'Nihai Kullanım Yeri')}{yaz('teslimTarihi', 'Teslim Tarihi', 'date')}{yaz('teslimYeri', 'Teslim Yeri')}{yaz('olcut', 'Kabul Ölçütü')}{yaz('gerekce', 'Seçim Gerekçesi')}{yaz('tanim', 'Ürün')}{yaz('parcaNo', 'Üretici Parça No')}{yaz('miktar', 'Miktar')}{yaz('birim', 'Birim')}{yaz('bedel', 'Birim Bedel (EUR)')}
      <button className="btn2" onClick={() => { setHata(''); void istek<{ siparisNo: string }>(`/dosya/${id}/siparis`, { ...f, kalemler: [{ tanim: f.tanim, parcaNo: f.parcaNo, miktar: Number(f.miktar.replace(',', '.')), birim: f.birim, bedel: Number(f.bedel.replace(',', '.')) }] }).then((r) => setNot(`${r.siparisNo} onaya gönderildi.`)).catch((x) => setHata((x as Error).message)); }}>Siparişi Onaya Gönder</button>
    </Blok>
  );
}
