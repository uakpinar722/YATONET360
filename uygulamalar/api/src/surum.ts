import type { FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';

export const CAKISMA_HATA = 'Bu kayıt siz düzenlerken başka bir kullanıcı tarafından güncellendi. Güncel kaydı yükleyip değişikliğinizi yeniden yapmanızı rica ederiz.';

/** YG-1382: istemci gördüğü kayıt sürümünü gönderirse güncel sürümle karşılaştırılır; farklıysa 409 ve çakışma işareti döner. Sürüm gönderilmezse denetim yapılmaz. */
export async function surumCakismasi(db: Pool | PoolClient, y: FastifyReply, tablo: 'yat' | 'acik_konu', kimlik: string, beklenen: unknown): Promise<boolean> {
  if (beklenen === undefined || beklenen === null) return false;
  const r = (await db.query(`SELECT kayit_surumu::text s FROM ${tablo} WHERE kimlik = $1`, [kimlik])).rows[0];
  if (!r || r.s === String(beklenen)) return false;
  await y.code(409).send({ hata: CAKISMA_HATA, cakisma: true, guncelSurum: Number(r.s) });
  return true;
}
