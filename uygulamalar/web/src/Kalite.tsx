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
  const [ie, setIe] = useState<{ kimlik: string; is_emri_no: string; statu: string; teknik_kabul?: string | null }[]>([]); const [kpk, setKpk] = useState<Record<string, string>>({});
  const [kp, setKp] = useState({ isEmri: '', tur: 'Bekletme', ozellik: '', olcut: '', zaman: '', eksperKlas: false }); const [kk, setKk] = useState({ isEmri: '', bitis: '', tanim: '', etki: '', hedef: '' });
  useEffect(() => { void istek<{ isEmirleri: typeof ie }>(`/dosya/${id}/teklifler`).then((r) => setIe(r.isEmirleri)).catch(() => {}); }, [id, v]);
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
        {v.kontrolNoktalari.map((k) => { const a = kpk[k.kimlik] ?? ''; return <div className="soru" key={k.kimlik}><span>{k.kontrol_noktasi_no} · {k.nokta_turu} · {k.kontrol_ozelligi} · {k.serbest_birakma_zamani ? 'Serbest Bırakıldı' : k.sonuc ?? 'Bekliyor'}</span>{!k.serbest_birakma_zamani && <>
          <BelgeSec ad="Kontrol Kanıtı" bagTuru="Dosya" bagKimligi={id} deger={a} sec={(x) => setKpk({ ...kpk, [k.kimlik]: x })} />
          <div className="dugmeler">{['Uygun', 'Düzeltme gerekli', 'Reddedildi'].map((s) => <button key={s} className="btn2 kucuk" disabled={!a} onClick={() => void yap(() => istek(`/kontrol-noktasi/${k.kimlik}/sonuc`, { sonuc: s, kanit: a }))}>{s}</button>)}</div></>}</div>; })}
        {teknik && ie.length > 0 && <>
          <label htmlFor="kp-e">İş Emri</label><select id="kp-e" value={kp.isEmri} onChange={(e) => setKp({ ...kp, isEmri: e.target.value })}><option value="">Seçiniz</option>{ie.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.is_emri_no}</option>)}</select>
          <label htmlFor="kp-t">Nokta Türü</label><select id="kp-t" value={kp.tur} onChange={(e) => setKp({ ...kp, tur: e.target.value })}>{['Bekletme', 'Tanıklık', 'Belge İnceleme', 'Gözetim', 'Uygulayıcı Öz Kontrolü', 'Bağımsız Doğrulama'].map((x) => <option key={x}>{x}</option>)}</select>
          <label htmlFor="kp-o">Kontrol Özelliği</label><input id="kp-o" value={kp.ozellik} onChange={(e) => setKp({ ...kp, ozellik: e.target.value })} />
          <label htmlFor="kp-k">Kabul Ölçütü (Ölçülebilir)</label><input id="kp-k" value={kp.olcut} onChange={(e) => setKp({ ...kp, olcut: e.target.value })} />
          <label htmlFor="kp-z">Planlanan Zaman</label><input id="kp-z" type="datetime-local" value={kp.zaman} onChange={(e) => setKp({ ...kp, zaman: e.target.value })} />
          <label className="kutu"><input type="checkbox" checked={kp.eksperKlas} onChange={(e) => setKp({ ...kp, eksperKlas: e.target.checked })} /><span>Eksper veya Klas Katılacak</span></label>
          <button className="btn2" disabled={!kp.isEmri} onClick={() => void yap(() => istek(`/is-emri/${kp.isEmri}/kontrol-noktasi`, { tur: kp.tur, ozellik: kp.ozellik, olcut: kp.olcut, zaman: kp.zaman && new Date(kp.zaman).toISOString(), eksperKlas: kp.eksperKlas }), 'Kontrol noktası eklendi.')}>Kontrol Noktası Ekle</button>
          <button className="btn2" disabled={!kp.isEmri} onClick={() => void yap(() => istek(`/is-emri/${kp.isEmri}/izin-gerekli`, { gerekli: true }), 'Bu iş emrinde çalışma izni belgesi zorunlu oldu.')}>Çalışma İzni Zorunlu</button>
        </>}
      </Blok>
      {teknik && ie.some((x) => x.statu === 'Tamamlandı' && !x.teknik_kabul) && <Blok baslik="Koşullu Kabul">
        <div className="not">Yalnız Minör açık işlerde verilir; bitiş en geç 30 gündür.</div>
        <label htmlFor="kk-e">İş Emri</label><select id="kk-e" value={kk.isEmri} onChange={(e) => setKk({ ...kk, isEmri: e.target.value })}><option value="">Seçiniz</option>{ie.filter((x) => x.statu === 'Tamamlandı').map((x) => <option key={x.kimlik} value={x.kimlik}>{x.is_emri_no}</option>)}</select>
        <label htmlFor="kk-b">Koşul Bitişi</label><input id="kk-b" type="date" value={kk.bitis} onChange={(e) => setKk({ ...kk, bitis: e.target.value })} />
        <label htmlFor="kk-t">Açık İş</label><input id="kk-t" value={kk.tanim} onChange={(e) => setKk({ ...kk, tanim: e.target.value })} />
        <label htmlFor="kk-i">Etki</label><input id="kk-i" value={kk.etki} onChange={(e) => setKk({ ...kk, etki: e.target.value })} />
        <label htmlFor="kk-h">Hedef Tarih</label><input id="kk-h" type="date" value={kk.hedef} onChange={(e) => setKk({ ...kk, hedef: e.target.value })} />
        <button className="btn2" disabled={!kk.isEmri} onClick={() => void yap(() => istek(`/is-emri/${kk.isEmri}/kosullu-kabul`, { bitis: kk.bitis, kalemler: [{ tanim: kk.tanim, etki: kk.etki, hedef: kk.hedef }] }), 'Koşullu kabul kaydedildi.')}>Koşullu Kabul Ver</button>
      </Blok>}
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

interface Siparisler { siparisler: { kimlik: string; siparis_no: string; statu: string; kdv_haric_eur: string; ticari_unvan: string }[]; girisler: { kimlik: string; kayit_no: string; siparis_ref: string; miktar: string; lot_no: string; kabul_karari: string | null; benim: boolean }[] }

/** YG-823, YG-404, YG-1589: sipariş Tedarik Sorumlusundan onay zincirine gider; giriş kontrolünü Saha Sorumlusu, yoksa Teknik Uzman yapar. */
export function TedarikBolumu({ id, roller }: { id: string; roller: string[] }) {
  const [f, setF] = useState({ tedarikci: '', teklifRef: '', kullanim: '', teslimTarihi: '', teslimYeri: '', olcut: '', gerekce: '', tanim: '', parcaNo: '', miktar: '1', birim: 'adet', bedel: '' });
  const [v, setV] = useState<Siparisler | null>(null); const [ted, setTed] = useState<{ kimlik: string; ticari_unvan: string; engel: string | null }[]>([]); const [yer, setYer] = useState<{ kimlik: string; ticari_unvan: string }[]>([]);
  const [g, setG] = useState({ lot: '', irsaliye: '', miktar: '', bekletmeYeri: '' }); const [fa, setFa] = useState({ no: '', tarih: '', tutar: '' });
  const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  const ts = roller.includes('Tedarik Sorumlusu');
  const yukle = () => istek<Siparisler>(`/dosya/${id}/siparisler`).then(setV);
  useEffect(() => { void yukle().catch(() => {}); if (ts) { void istek<typeof ted>('/firma/uygunluk?rol=Tedarikçi').then(setTed).catch(() => {}); void istek<typeof yer>('/firma/uygunluk').then(setYer).catch(() => {}); } }, [id]);
  const yap = (p: Promise<unknown>, t: string) => { setHata(''); setNot(''); void p.then(() => { setNot(t); return yukle(); }).catch((x) => setHata((x as Error).message)); };
  if (!v || (!ts && !v.siparisler.length)) return null;
  const yaz = (k: keyof typeof f, ad: string, tur = 'text') => <><label htmlFor={`sp-${k}`}>{ad}</label><input id={`sp-${k}`} type={tur} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  const sayi = (x: string) => Number(x.replace(/\./g, '').replace(',', '.'));
  return (
    <Blok baslik="Tedarik">
      {hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}
      {v.siparisler.map((s) => (
        <div className="soru" key={s.kimlik}>
          <span>{s.siparis_no} · {s.ticari_unvan} · {s.statu}</span>
          {ts && ['Verildi', 'Kısmi Teslim'].includes(s.statu) && <>
            <label htmlFor={`g-l-${s.kimlik}`}>Lot No</label><input id={`g-l-${s.kimlik}`} value={g.lot} onChange={(e) => setG({ ...g, lot: e.target.value })} />
            <label htmlFor={`g-i-${s.kimlik}`}>İrsaliye No</label><input id={`g-i-${s.kimlik}`} value={g.irsaliye} onChange={(e) => setG({ ...g, irsaliye: e.target.value })} />
            <label htmlFor={`g-m-${s.kimlik}`}>Teslim Miktarı</label><input id={`g-m-${s.kimlik}`} inputMode="decimal" value={g.miktar} onChange={(e) => setG({ ...g, miktar: e.target.value })} />
            <label htmlFor={`g-y-${s.kimlik}`}>Bekletme Yeri</label><select id={`g-y-${s.kimlik}`} value={g.bekletmeYeri} onChange={(e) => setG({ ...g, bekletmeYeri: e.target.value })}><option value="">Seçiniz</option>{[...yer, ...ted].map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ticari_unvan}</option>)}</select>
            <button className="btn2 kucuk" onClick={() => yap(istek(`/siparis/${s.kimlik}/giris`, { satir: 1, lot: g.lot, irsaliye: g.irsaliye, miktar: sayi(g.miktar), bekletmeYeri: g.bekletmeYeri }), 'Giriş kaydı teknik kontrole gönderildi.')}>Teknik Kontrole Gönder</button>
          </>}
          {ts && ['Kısmi Teslim', 'Teslim Alındı'].includes(s.statu) && <>
            <div className="iki-tarih"><div><label htmlFor={`fa-n-${s.kimlik}`}>Tedarikçi Fatura No</label><input id={`fa-n-${s.kimlik}`} value={fa.no} onChange={(e) => setFa({ ...fa, no: e.target.value })} /></div><div><label htmlFor={`fa-t-${s.kimlik}`}>Fatura Tarihi</label><input id={`fa-t-${s.kimlik}`} type="date" value={fa.tarih} onChange={(e) => setFa({ ...fa, tarih: e.target.value })} /></div></div>
            <label htmlFor={`fa-u-${s.kimlik}`}>KDV Hariç Tutar (EUR)</label><input id={`fa-u-${s.kimlik}`} inputMode="decimal" value={fa.tutar} onChange={(e) => setFa({ ...fa, tutar: e.target.value })} />
            <button className="btn2 kucuk" onClick={() => { setHata(''); setNot(''); void istek<{ sonuc: string }>(`/siparis/${s.kimlik}/eslestirme`, { no: fa.no, tarih: fa.tarih, tutar: sayi(fa.tutar) }).then((r) => setNot(`Eşleştirme: ${r.sonuc}`)).catch((x) => setHata((x as Error).message)); }}>Üçlü Eşleştir</button>
          </>}
        </div>
      ))}
      {v.girisler.map((m) => <div className="soru" key={m.kimlik}><span>{m.kayit_no} · Lot {m.lot_no} · {m.miktar} · {m.kabul_karari ?? 'Kontrol Bekliyor'}</span>{m.benim && !m.kabul_karari && <div className="dugmeler">{['Kabul', 'Koşullu Kabul', 'Karantina', 'Ret', 'İade Edildi'].map((k) => <button key={k} className="btn2 kucuk" onClick={() => yap(istek(`/malzeme-giris/${m.kimlik}/karar`, { karar: k }), 'Karar kaydedildi.')}>{k}</button>)}</div>}</div>)}
      {ts && <>
        <label htmlFor="sp-ted">Tedarikçi</label><select id="sp-ted" value={f.tedarikci} onChange={(e) => setF({ ...f, tedarikci: e.target.value })}><option value="">Seçiniz</option>{ted.map((x) => <option key={x.kimlik} value={x.kimlik} disabled={Boolean(x.engel)}>{x.ticari_unvan}{x.engel ? ` · ${x.engel}` : ''}</option>)}</select>
        {yaz('teklifRef', 'Tedarikçi Teklif No')}{yaz('kullanim', 'Nihai Kullanım Yeri')}{yaz('teslimTarihi', 'Teslim Tarihi', 'date')}{yaz('teslimYeri', 'Teslim Yeri')}{yaz('olcut', 'Kabul Ölçütü')}{yaz('gerekce', 'Seçim Gerekçesi')}{yaz('tanim', 'Ürün')}{yaz('parcaNo', 'Üretici Parça No')}{yaz('miktar', 'Sipariş Miktarı')}{yaz('birim', 'Birim')}{yaz('bedel', 'Birim Bedel (EUR)')}
        <button className="btn2" onClick={() => yap(istek(`/dosya/${id}/siparis`, { ...f, kalemler: [{ tanim: f.tanim, parcaNo: f.parcaNo, miktar: sayi(f.miktar), birim: f.birim, bedel: sayi(f.bedel) }] }), 'Sipariş onaya gönderildi.')}>Siparişi Onaya Gönder</button>
      </>}
    </Blok>
  );
}

interface YatDegeriV { durum: string; deger: string | null; ekPolice: string | null; gorusler: { rol: string; deger_eur: string; dayanak: string }[]; rollerim: string[] }

/** K-240, YG-985: yat değerine dosyaya atanmış Operasyon Yöneticisi ve Teknik Yönetici ortak karar verir; yetkisiz kullanıcıya bölüm görünmez. */
export function YatDegeriBolumu({ id }: { id: string }) {
  const [v, setV] = useState<YatDegeriV | null>(null); const [deger, setDeger] = useState(''); const [dayanak, setDayanak] = useState(''); const [hata, setHata] = useState('');
  const yukle = () => istek<YatDegeriV>(`/dosya/${id}/yat-degeri`).then(setV);
  useEffect(() => { void yukle().catch(() => setV(null)); }, [id]);
  if (!v) return null;
  const para = (x: string) => `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  return (
    <Blok baslik="Yat Değeri Ortak Kararı">
      {hata && <div className="hata" role="alert">{hata}</div>}
      <div>Durum: <b className="koyu">{v.durum}</b>{v.deger ? ` · ${para(v.deger)}` : ''}{v.ekPolice ? ` · Ek Poliçe: ${v.ekPolice}` : ''}</div>
      {v.gorusler.map((g) => <div key={g.rol}>{g.rol}: {para(g.deger_eur)} · {g.dayanak}</div>)}
      {v.durum === 'Uyuşmazlık' && <div className="uyari">Değerler aynı olmadan teklif gönderilemez ve iş emri verilemez.</div>}
      {v.rollerim.length > 0 && <>
        <label htmlFor="yd-d">Değer (EUR)</label><input id="yd-d" inputMode="decimal" value={deger} onChange={(e) => setDeger(e.target.value)} />
        <label htmlFor="yd-g">Dayanak</label><input id="yd-g" value={dayanak} onChange={(e) => setDayanak(e.target.value)} />
        <button className="btn2" onClick={() => { setHata(''); void istek(`/dosya/${id}/yat-degeri`, { deger: Number(deger.replace(/\./g, '').replace(',', '.')), dayanak }).then(yukle).catch((x) => setHata((x as Error).message)); }}>Görüşü Kaydet</button>
      </>}
    </Blok>
  );
}

interface Gonderim { kimlik: string; tur: string; alici: string; konu: string; metin: string | null; durum: string; benimBirinci: boolean; ekler: string[]; onizleme: boolean }

/** K-241: sigortaya giden her ileti ve belge, son gönderenin iki ayrı teyidiyle çıkar. İkinci düğme metin görüldükten sonra açılır. */
export function SigortaEposta({ id, eposta, yenile }: { id: string; eposta: string | null; yenile: () => unknown }) {
  const [v, setV] = useState(''); const [hata, setHata] = useState(''); const [ac, setAc] = useState(false);
  const kaydet = () => { setHata(''); void istek(`/dosya/${id}/sigorta-eposta`, { eposta: v }).then(() => { setAc(false); setV(''); return yenile(); }).catch((x) => setHata((x as Error).message)); };
  return (
    <div>
      {eposta ? <>Sigorta E-postası: {eposta} <button className="btn2 kucuk" onClick={() => setAc(!ac)}>Değiştir</button></> : <span className="uyari">⚠ Sigorta şirketinin e-posta adresi bekleniyor. <button className="btn2 kucuk" onClick={() => setAc(!ac)}>Adres Gir</button></span>}
      {ac && <div><label htmlFor={`sge-${id}`}>Sigorta E-postası</label><input id={`sge-${id}`} type="email" value={v} onChange={(e) => setV(e.target.value)} /><button className="btn2 kucuk" disabled={!v.trim()} onClick={kaydet}>Kaydet</button></div>}
      {hata && <div className="hata" role="alert">{hata}</div>}
    </div>
  );
}

export function SigortaGonderimBolumu({ id }: { id: string }) {
  const [l, setL] = useState<Gonderim[]>([]); const [hata, setHata] = useState(''); const [hazir, setHazir] = useState<Record<string, boolean>>({}); const [baglanti, setBaglanti] = useState(''); const [iptal, setIptal] = useState<Record<string, string>>({});
  const yukle = () => istek<Gonderim[]>(`/sigorta-gonderim?dosya=${id}`).then(setL).catch((x) => setHata((x as Error).message));
  useEffect(() => { void yukle(); const f = () => void yukle(); window.addEventListener('sigorta-gonderim', f); return () => window.removeEventListener('sigorta-gonderim', f); }, [id]);
  const ac = (k: string) => setTimeout(() => setHazir((h) => ({ ...h, [k]: true })), 2100);
  useEffect(() => { for (const g of l) if (g.durum === 'Birinci Teyit' && !hazir[g.kimlik]) ac(g.kimlik); }, [l]);
  const teyit = (g: Gonderim, adim: number) => { setHata(''); void istek<{ baglanti?: string }>(`/sigorta-gonderim/${g.kimlik}/teyit`, { adim }).then((r) => { if (r.baglanti) setBaglanti(r.baglanti); return yukle(); }).catch((x) => setHata((x as Error).message)); };
  if (!l.length && !baglanti && !hata) return null;
  return (
    <Blok baslik="Sigortaya Gönderim Teyidi">
      {hata && <div className="hata" role="alert">{hata}</div>}
      {baglanti && <div className="not" role="status">Paylaşım Bağlantısı: {baglanti}</div>}
      {l.map((g) => (
        <div className="soru" key={g.kimlik}>
          <span><b className="koyu">{g.tur}</b> · {g.konu}</span>
          <div>Alıcı: {g.alici}</div>
          {g.ekler.length > 0 && <div>Ekler: {g.ekler.join(' · ')}</div>}
          {g.onizleme && <div><a href={`/api/sigorta-gonderim/${g.kimlik}/onizleme`} target="_blank" rel="noreferrer">Teklif PDF Önizleme</a></div>}
          {g.durum === 'Teyit Bekliyor' && <button className="btn2 kucuk" onClick={() => teyit(g, 1)}>Birinci Teyit: İçeriği Gördüm</button>}
          {g.durum === 'Birinci Teyit' && <>
            {g.metin && <div className="ozet">{g.metin}</div>}
            {g.benimBirinci ? <button className="btn" disabled={!hazir[g.kimlik]} onClick={() => teyit(g, 2)}>İkinci Teyit: Sigortaya Gönder</button> : <div className="not">Birinci teyidi başka kişi verdi; ikinci teyidi o kişi verir.</div>}
          </>}
          <label htmlFor={`sgi-${g.kimlik}`}>Vazgeçme Gerekçesi</label><input id={`sgi-${g.kimlik}`} value={iptal[g.kimlik] ?? ''} onChange={(e) => setIptal({ ...iptal, [g.kimlik]: e.target.value })} />
          <button className="btn2 kucuk" disabled={!iptal[g.kimlik]?.trim()} onClick={() => { setHata(''); void istek(`/sigorta-gonderim/${g.kimlik}/iptal`, { gerekce: iptal[g.kimlik] }).then(yukle).catch((x) => setHata((x as Error).message)); }}>Vazgeç</button>
        </div>
      ))}
    </Blok>
  );
}

interface RaporV { raporlar: { kimlik: string; rapor_no: string; rapor_turu: string; durum: string; kademe: number | null; kademe_sayisi: number | null }[]; firmaRaporu: { rapor_no: string; bulgular: string; onerilen_islemler: string; malzeme_ihtiyaci: string | null; tahmini_sure_gun: number; firma_degerlendirmesi: string } | null; oneri: { bulgular: string; oneriler: string; analiz: string } | null }
const RAPOR_ALAN: [string, string][] = [['kapsam', 'Görevlendirme Kapsamı'], ['incelenen', 'İncelenen Alan'], ['saha', 'Saha Koşulları'], ['yontem', 'Yöntem ve Ölçüt'], ['bulgular', 'Bulgular'], ['acikSorular', 'Açık Sorular'], ['analiz', 'Analiz ve Risk'], ['oneriler', 'Öneriler'], ['uzmanlik', 'Uzmanlık Sınırı']];

/** YG-200, YG-280: firma girdisi forma kendiliğinden gelir; Teknik Uzman düzeltir. Firma raporu dışa giden rapora yazılmaz. */
export function RaporBolumu({ id, rollerim }: { id: string; rollerim: string[] }) {
  const [v, setV] = useState<RaporV | null>(null); const [f, setF] = useState<Record<string, string>>({ tur: 'İlk Rapor' }); const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  const [ko, setKo] = useState({ ana: '', alt: '', tali: '', islem: '', birim: 'adet', maliyet: '', gerekce: '' });
  const yukle = () => istek<RaporV>(`/dosya/${id}/teknik-rapor`).then((r) => { setV(r); if (r.oneri) setF((x) => ({ bulgular: r.oneri!.bulgular, oneriler: r.oneri!.oneriler, analiz: r.oneri!.analiz, ...x })); });
  useEffect(() => { void yukle().catch((x) => setHata((x as Error).message)); }, [id]);
  if (!v) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  const tu = rollerim.includes('Teknik Uzman') || rollerim.includes('Sorumlu Teknik Uzman (Koordinatör)');
  const yap = (p: Promise<unknown>, t: string) => { setHata(''); setNot(''); void p.then(() => { setNot(t); return yukle(); }).catch((x) => setHata((x as Error).message)); };
  return (
    <Blok baslik="Teknik Rapor">
      {hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}
      {v.raporlar.length === 0 && <div className="not">Teknik Rapor bulunmamaktadır.</div>}
      {v.raporlar.map((r) => <div key={r.kimlik}>{r.rapor_no} · {r.rapor_turu} · {r.durum}{r.durum === 'Kontrolde' && r.kademe_sayisi ? ` · Kademe ${(r.kademe ?? 0) + 1} / ${r.kademe_sayisi}` : ''}</div>)}
      {tu && v.firmaRaporu && <div className="not">Firma Raporu {v.firmaRaporu.rapor_no} forma aktarıldı; düzeltmeleriniz kayda geçer. Tahmini Süre: {v.firmaRaporu.tahmini_sure_gun} Gün{v.firmaRaporu.malzeme_ihtiyaci ? ` · Malzeme: ${v.firmaRaporu.malzeme_ihtiyaci}` : ''}</div>}
      {tu && <>
        <label htmlFor="rp-t">Rapor Türü</label><select id="rp-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['İlk Rapor', 'Ek Teknik Rapor', 'Garanti İnceleme Raporu'].map((x) => <option key={x}>{x}</option>)}</select>
        {RAPOR_ALAN.map(([k, ad]) => <div key={k}><label htmlFor={`rp-${k}`}>{ad}</label><textarea id={`rp-${k}`} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
        <button className="btn2" onClick={() => yap(istek(`/dosya/${id}/teknik-rapor`, f), 'Rapor kontrole gönderildi.')}>Raporu Kontrole Gönder</button>
        <div className="bolum">Kartela Önerisi</div>
        {([['ana', 'Ana Branş'], ['alt', 'Alt Branş'], ['tali', 'Tali Branş'], ['islem', 'İşlem'], ['birim', 'Birim'], ['maliyet', 'Maliyet (EUR)'], ['gerekce', 'Gerekçe']] as const).map(([k, ad]) => <div key={k}><label htmlFor={`ko-${k}`}>{ad}</label><input id={`ko-${k}`} value={ko[k]} onChange={(e) => setKo({ ...ko, [k]: e.target.value })} /></div>)}
        <button className="btn2" onClick={() => yap(istek(`/dosya/${id}/kart-onerisi`, { ...ko, maliyet: Number(ko.maliyet.replace(/\./g, '').replace(',', '.')) }), 'Öneri Ticari İşler Direktörüne gönderildi.')}>Kart Öner</button>
      </>}
    </Blok>
  );
}
