import type { PoolClient } from 'pg';

export type KapanisIsleyici = (c: PoolClient, kart: { nesne_kimligi: string | null; ozet: string | null }, karar: string, yapan: string) => Promise<void>;
export const KAPANIS = new Map<string, KapanisIsleyici>();
/** Modül, kendi kart türünün kararını aynı veritabanı işleminde kendi kaydına işler (YG-1143, YG-1145). */
export function kapanisKaydet(tur: string, f: KapanisIsleyici) { KAPANIS.set(tur, f); }
