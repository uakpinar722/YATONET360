-- YG-1365: birleşik durum sözlüğü. Durum listeleri veri tabanı kısıtlarından okunur; iş anlamı ve kurallar burada tutulur.
CREATE TABLE durum_sozlugu (
  kayit_turu text NOT NULL, durum text NOT NULL, is_anlami text NOT NULL CHECK (length(trim(is_anlami)) > 0), giris_kosulu text NOT NULL, cikis_kosulu text NOT NULL, yetkili_rol text NOT NULL,
  izinli_gecisler text[] NOT NULL DEFAULT '{}', zorunlu_aciklama boolean NOT NULL DEFAULT false, sure_durur boolean NOT NULL DEFAULT false, otomatik_bildirim text, musteri_adi text,
  guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (kayit_turu, durum)
);
GRANT SELECT, INSERT, UPDATE ON durum_sozlugu TO yatonet_uygulama;
-- Uygulama rolü kısıtları okuyabilsin diye durum değerlerini veren görünüm.
CREATE VIEW durum_kaynagi AS
  SELECT c.conrelid::regclass::text AS kayit_turu, a.attname::text AS alan, pg_get_constraintdef(c.oid) AS tanim
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'c' AND cardinality(c.conkey) = 1 AND (a.attname = 'durum' OR a.attname = 'statu' OR a.attname LIKE '%\_durumu' OR a.attname LIKE '%\_durum')
    AND c.connamespace = 'public'::regnamespace;
GRANT SELECT ON durum_kaynagi TO yatonet_uygulama;
