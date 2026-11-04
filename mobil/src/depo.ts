// YG-494: kuyruk cihazda SQLCipher ile şifreli tutulur; anahtar cihaz güvenli alanındadır.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { KuyrukDeposu, KuyrukKaydi } from './cevrimdisi';

const ANAHTAR = 'yatonet360.kuyruk.anahtar';

async function anahtarAl(): Promise<string> {
  const v = await SecureStore.getItemAsync(ANAHTAR);
  if (v) return v;
  const y = Array.from(await Crypto.getRandomBytesAsync(32)).map((b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(ANAHTAR, y, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return y;
}

export async function sifreliDepoAc(): Promise<KuyrukDeposu> {
  const db = await SQLite.openDatabaseAsync('kuyruk.db');
  await db.execAsync(`PRAGMA key = "x'${await anahtarAl()}'"; CREATE TABLE IF NOT EXISTS kuyruk (kimlik TEXT PRIMARY KEY, veri TEXT NOT NULL);`);
  return {
    hepsi: async () => (await db.getAllAsync<{ veri: string }>('SELECT veri FROM kuyruk')).map((r) => JSON.parse(r.veri) as KuyrukKaydi),
    yaz: async (k) => { await db.runAsync('INSERT OR REPLACE INTO kuyruk (kimlik, veri) VALUES (?, ?)', k.kimlik, JSON.stringify(k)); },
    sil: async (kimlik) => { await db.runAsync('DELETE FROM kuyruk WHERE kimlik = ?', kimlik); },
  };
}
