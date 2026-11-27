-- YG-1387, HG-1 (V-1126): onay adımının hukuki gerekçesi ve ilgili belge bölümü; Hukuk ve Uyum hazırlar, CEO onaylar, yalnız yürürlükteki gösterilir.
CREATE TABLE neden_metni (
  kart_turu text NOT NULL, surum integer NOT NULL, metin text NOT NULL CHECK (length(trim(metin)) > 0), belge_bolumu text,
  durum text NOT NULL CHECK (durum IN ('Taslak', 'Onayda', 'Yürürlükte', 'Yerine Geçti')),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kart_turu, surum)
);
CREATE UNIQUE INDEX neden_metni_yururlukte ON neden_metni (kart_turu) WHERE durum = 'Yürürlükte';
GRANT SELECT, INSERT, UPDATE ON neden_metni TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('neden_metni', 'Taslak', 'Kayıt hazırlanıyor; henüz gönderilmedi ve sonuç doğurmaz.', 'CEO iade veya ret edince', 'Hukuk ve Uyum yeni sürümü onaya gönderince', 'Hukuk ve Uyum Direktörü', ARRAY['Onayda'], false, false, NULL, NULL),
  ('neden_metni', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Hukuk ve Uyum metni onaya gönderince', 'CEO kararıyla Yürürlükte veya Taslak', 'CEO', ARRAY['Yürürlükte', 'Taslak'], false, false, 'Onay kartı', NULL),
  ('neden_metni', 'Yürürlükte', 'Kayıt onaylanmış ve geçerlilik süresi içinde uygulanıyor.', 'CEO onaylayınca', 'Yeni sürüm yürürlüğe girince Yerine Geçti', 'CEO', ARRAY['Yerine Geçti'], false, false, NULL, NULL),
  ('neden_metni', 'Yerine Geçti', 'Kaydın yeni sürümü yürürlüğe girdi; bu sürüm yalnız geçmiş için saklanır.', 'Yeni sürüm yürürlüğe girince', 'Yok', 'Sistem', '{}'::text[], false, false, NULL, NULL)
ON CONFLICT DO NOTHING;
