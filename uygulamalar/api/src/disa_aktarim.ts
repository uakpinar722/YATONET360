import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { izYaz } from './denetim.js';
import { kartAc } from './is_motoru.js';
import { kapanisKaydet } from './kapanis.js';
import { tamOturumGerekli, type Baglam } from './kimlik.js';
import { onayMakami } from './makam.js';
import { UUID } from './yat.js';

type Db = Pool | PoolClient;
const TUR = 'Toplu Dışa Aktarma Onayı';
const KADEME = ['Yönetici', 'Müdür Yardımcısı', 'Müdür', 'Direktör', 'Genel Müdür Yardımcısı', 'CEO'];
const MALI = ['CEO', 'Genel Müdür Yardımcısı', 'Ticari İşler Direktörü', 'Teknik ve Operasyon Direktörü', 'Operasyon Müdürü', 'Muhasebe ve Finans Müdürü'];
/** V-395: en çok 5.000 kayıt; 1.000 kaydı aşan veya hassas alan içeren aktarım ek onaya gider; hazır aktarım 24 saat geçerli, bir kez indirilir. */
export const AKTARIM = { azami: 5000, onaySiniri: 1000, gecerlilikSaat: 24 };
type Set_ = { roller: string[] | null; alanlar: Record<string, string>; hassas: Record<string, string>; sql: (sec: string) => string };
const SETLER: Record<string, Set_> = {
  'Dosyalar': { roller: null, alanlar: { dosya_no: 'Dosya No', statu: 'Statü', asama: 'Aşama', oncelik: 'Öncelik', acilis: 'Açılış Tarihi', yat_adi: 'Yat Adı', konum: 'Konum' }, hassas: { yat_sahibi: 'Yat Sahibi', telefon: 'Yat Sahibi Telefonu' },
    sql: (s) => `SELECT ${s} FROM (SELECT d.dosya_no, d.statu, d.asama, d.oncelik, to_char(d.olusturma_zamani AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY') acilis, y.yat_adi, d.konum, t.kisi_adi_soyadi yat_sahibi, t.telefon FROM dosya d JOIN yat y ON y.kimlik = d.yat_ref LEFT JOIN LATERAL (SELECT kisi_adi_soyadi, telefon FROM dosya_tarafi x WHERE x.dosya_ref = d.kimlik AND x.taraf_rolu = 'Yat Sahibi' AND x.aktif LIMIT 1) t ON true ORDER BY d.dosya_no) v` },
  'İş Emirleri': { roller: MALI, alanlar: { is_emri_no: 'İş Emri No', tur: 'Tür', statu: 'Statü', dosya_no: 'Dosya No' }, hassas: { firma: 'Firma', bedel: 'Firma Bedeli (EUR)' },
    sql: (s) => `SELECT ${s} FROM (SELECT e.is_emri_no, e.is_emri_turu tur, e.statu, d.dosya_no, k.ticari_unvan firma, replace(to_char(e.firma_bedeli_eur, 'FM999999990.00'), '.', ',') bedel FROM is_emri e JOIN dosya d ON d.kimlik = e.dosya_ref LEFT JOIN kurulus k ON k.kimlik = e.kurulus_ref ORDER BY e.is_emri_no) v` },
};

kapanisKaydet(TUR, async (c, k, karar) => {
  if (karar === 'Onayla') await c.query(`UPDATE disa_aktarim SET durum = 'Hazır', son_gecerlilik = now() + make_interval(hours => $2) WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi, AKTARIM.gecerlilikSaat]);
  else if (karar === 'Reddet') await c.query(`UPDATE disa_aktarim SET durum = 'Reddedildi' WHERE kimlik = $1::uuid AND durum = 'Onayda'`, [k.nesne_kimligi]);
});

const csv = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** YG-755: toplu dışa aktarma yalnız Yönetici ve üstü kademelere; rol, alan, kayıt sayısı, biçim ve amaç sınırı; gerekçe; büyük veya hassas aktarım ek onay; indirilen dosya kimliğiyle kayıt. */
export function disaAktarimYollari(s: FastifyInstance, b: Baglam) {
  const oturumlu = { preHandler: tamOturumGerekli(b) };
  const yok = (y: FastifyReply) => y.code(404).send({ hata: 'Kayıt bulunamadı veya erişim yetkiniz yok.' });
  const roller = async (k: string) => (await b.db.query(`SELECT r.kimlik, r.rol_adi, r.kademe FROM rol_atamasi a JOIN rol r ON r.kimlik = a.rol_ref WHERE a.kullanici_ref = $1 AND a.atama_durumu = 'Aktif' AND r.kullanici_gruplari = 'LGM İç Rolü'`, [k])).rows as { kimlik: string; rol_adi: string; kademe: string }[];
  const setler = (r: { rol_adi: string; kademe: string }[]) => r.some((x) => KADEME.includes(x.kademe)) ? Object.entries(SETLER).filter(([, v]) => !v.roller || r.some((x) => v.roller!.includes(x.rol_adi))).map(([ad, v]) => ({ ad, alanlar: v.alanlar, hassas: v.hassas })) : [];
  const say = async (db: Db, st: Set_) => Number((await db.query(`SELECT count(*) n FROM (${st.sql('1')}) z`)).rows[0].n);

  s.get('/disa-aktarim', oturumlu, async (i, y) => {
    const o = i.oturum!; const l = setler(await roller(o.kullanici)); if (!l.length) return yok(y);
    return { setler: l, talepler: (await b.db.query(`SELECT kimlik, veri_seti, alanlar, kayit_sayisi, hassas, durum, son_gecerlilik, olusturma_zamani FROM disa_aktarim WHERE talep_eden_ref = $1 ORDER BY olusturma_zamani DESC LIMIT 20`, [o.kullanici])).rows };
  });
  s.post('/disa-aktarim', oturumlu, async (i, y) => {
    const o = i.oturum!; const r = await roller(o.kullanici); const l = setler(r); if (!l.length) return yok(y);
    const g = (i.body ?? {}) as { veriSeti?: string; alanlar?: string[]; amac?: string; gerekce?: string; bicim?: string };
    const st = l.find((x) => x.ad === g.veriSeti) ? SETLER[g.veriSeti!]! : null;
    if (!st) return y.code(400).send({ hata: 'Veri setini seçiniz.' });
    const alanlar = (Array.isArray(g.alanlar) ? g.alanlar : []).filter((a) => a in st.alanlar || a in st.hassas);
    if (!alanlar.length || alanlar.length !== (g.alanlar ?? []).length) return y.code(400).send({ hata: 'Alanları listeden seçiniz.' });
    if ((g.bicim ?? 'CSV') !== 'CSV') return y.code(400).send({ hata: 'Biçim CSV olmalıdır.' });
    if (!g.amac?.trim() || !g.gerekce?.trim()) return y.code(400).send({ hata: 'Amaç ve gerekçe zorunludur.' });
    const n = await say(b.db, st);
    if (n > AKTARIM.azami) return y.code(409).send({ hata: `Aktarım en çok ${AKTARIM.azami.toLocaleString('tr-TR')} kayıt içerebilir.` });
    const hassas = alanlar.some((a) => a in st.hassas); const onay = hassas || n > AKTARIM.onaySiniri;
    const c = await b.db.connect();
    try {
      await c.query('BEGIN');
      const t = (await c.query(`INSERT INTO disa_aktarim (veri_seti, alanlar, amac, gerekce, kayit_sayisi, hassas, durum, talep_eden_ref, son_gecerlilik) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7 = 'Hazır' THEN now() + make_interval(hours => $9) END) RETURNING kimlik`, [g.veriSeti, alanlar, g.amac.trim(), g.gerekce.trim(), n, hassas, onay ? 'Onayda' : 'Hazır', o.kullanici, AKTARIM.gecerlilikSaat])).rows[0].kimlik as string;
      if (onay) {
        const ust = r.find((x) => KADEME.includes(x.kademe))!; const makam = ust.rol_adi === 'CEO' ? ust.kimlik : await onayMakami(c, ust.kimlik);
        await kartAc(c, { tur: TUR, baslik: `${TUR}: ${g.veriSeti} (${n} kayıt)`, ozet: `${hassas ? 'Hassas alan · ' : ''}${g.amac.trim()} · ${g.gerekce.trim()}`.slice(0, 200), hazirlayan: o.kullanici, zincir: [makam], nesneTuru: 'Dışa Aktarma', nesneKimligi: t });
      }
      await izYaz(c, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplu Dışa Aktarma Talebi', nesneTuru: 'Dışa Aktarma', nesneKimligi: t, yeni: { veriSeti: g.veriSeti, alanlar, kayit: n, hassas }, gerekce: g.gerekce.trim(), sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
      await c.query('COMMIT');
      return { kimlik: t, durum: onay ? 'Onayda' : 'Hazır', kayit: n };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  s.get('/disa-aktarim/:id/indir', oturumlu, async (i, y) => {
    const o = i.oturum!; const { id } = i.params as { id: string }; if (!UUID.test(id)) return yok(y);
    const t = (await b.db.query(`SELECT * FROM disa_aktarim WHERE kimlik = $1 AND talep_eden_ref = $2`, [id, o.kullanici])).rows[0]; if (!t) return yok(y);
    if (t.durum !== 'Hazır') return y.code(409).send({ hata: t.durum === 'Onayda' ? 'Aktarım onay beklemektedir.' : 'Aktarım indirilemez.' });
    if (new Date(t.son_gecerlilik) < new Date()) { await b.db.query(`UPDATE disa_aktarim SET durum = 'Süresi Doldu' WHERE kimlik = $1`, [id]); return y.code(409).send({ hata: 'Aktarımın süresi dolmuştur; yeniden talep ediniz.' }); }
    const st = SETLER[t.veri_seti]!; const ad = { ...st.alanlar, ...st.hassas } as Record<string, string>;
    const satir = (await b.db.query(st.sql((t.alanlar as string[]).map((a) => `v.${a}`).join(', ')))).rows.slice(0, AKTARIM.azami);
    const govde = '﻿' + [(t.alanlar as string[]).map((a) => csv(ad[a])).join(';'), ...satir.map((r) => (t.alanlar as string[]).map((a) => csv(r[a])).join(';'))].join('\r\n');
    const ozet = createHash('sha256').update(govde).digest('hex');
    const dk = (await b.db.query(`INSERT INTO disa_aktarim_indirme (aktarim_ref, kayit_sayisi, ozet_sha256, indiren_ref, adres) VALUES ($1,$2,$3,$4,$5) RETURNING dosya_kimligi`, [id, satir.length, ozet, o.kullanici, i.ip])).rows[0].dosya_kimligi as string;
    await b.db.query(`UPDATE disa_aktarim SET durum = 'İndirildi' WHERE kimlik = $1`, [id]);
    await izYaz(b.db, { aktor: o.kullanici, oturum: o.oturum, eylem: 'Toplu Dışa Aktarma İndirildi', nesneTuru: 'Dışa Aktarma', nesneKimligi: id, yeni: { dosya: dk, kayit: satir.length, sha256: ozet }, sonuc: 'Başarılı', adres: i.ip, iliski: i.id });
    return y.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="aktarim-${dk}.csv"`).header('x-dosya-kimligi', dk).send(govde);
  });
}
