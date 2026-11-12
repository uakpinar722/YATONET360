-- YG-679: LGM çizim antetli teknik çizim ve kroki; revizyon tablosu.
CREATE TABLE teknik_cizim (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), cizim_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), ad text NOT NULL, olcek text NOT NULL,
  belge_ref uuid NOT NULL REFERENCES belge (kimlik), genel_notlar text, revizyon integer NOT NULL DEFAULT 0 CHECK (revizyon >= 0),
  durum text NOT NULL DEFAULT 'Taslak' CHECK (durum IN ('Taslak', 'Onayda', 'Onaylı')),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE teknik_cizim_revizyonu (
  cizim_ref uuid NOT NULL REFERENCES teknik_cizim (kimlik), rev_no integer NOT NULL, tarih date NOT NULL DEFAULT current_date, aciklama text NOT NULL,
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), PRIMARY KEY (cizim_ref, rev_no)
);
GRANT SELECT, INSERT, UPDATE ON teknik_cizim TO yatonet_uygulama;
GRANT SELECT, INSERT ON teknik_cizim_revizyonu TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('teknik_cizim', 'Taslak', 'Kayıt hazırlanıyor; henüz gönderilmedi ve sonuç doğurmaz.', 'Çizim kaydedilince, iade edilince veya revizyon açılınca', 'Hazırlayan onaya gönderince Onayda', 'Teknik Uzman', ARRAY['Onayda']::text[], false, false, NULL, NULL),
 ('teknik_cizim', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Hazırlayan onaya gönderince', 'Teknik Yönetici onaylarsa Onaylı, iade ederse Taslak', 'Teknik Yönetici', ARRAY['Onaylı', 'Taslak']::text[], false, false, 'Teknik Yöneticiye onay kartı', NULL),
 ('teknik_cizim', 'Onaylı', 'Kayıt yetkili makamca onaylanmış durumda.', 'Teknik Yönetici onaylayınca', 'Değişiklik yeni revizyonla Taslak', 'Teknik Yönetici', ARRAY['Taslak']::text[], false, false, NULL, NULL);
