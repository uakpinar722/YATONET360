-- YG-1654 (A38): risk esaslı firma denetim planı (tür, tarih, denetçi; erteleme gerekçesi ve yeni tarih; denetçi çıkar çatışması beyanı).
CREATE TABLE firma_denetim_plani (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik),
  tur text NOT NULL CHECK (tur IN ('Belge ve Sicil', 'Uzaktan Dosya', 'Saha ve Tesis', 'Olay Sonrası', 'Takip', 'Yeniden Kabul')),
  planlanan_tarih date NOT NULL, denetci_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), risk_gerekcesi text NOT NULL,
  durum text NOT NULL DEFAULT 'Planlandı' CHECK (durum IN ('Planlandı', 'Tamamlandı')),
  erteleme_sayisi integer NOT NULL DEFAULT 0, son_erteleme_gerekcesi text, sonuc text,
  planlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), tamamlanma_zamani timestamptz
);
GRANT SELECT, INSERT, UPDATE ON firma_denetim_plani TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('firma_denetim_plani', 'Planlandı', 'İş için tarih ve sorumlu belirlendi; henüz başlamadı.', 'Firma Yönetimi Müdür Yardımcısı veya Yöneticisi denetimi planlayınca; ertelemede gerekçe ve yeni tarihle aynı durumda kalır', 'Denetçi sonucu kaydedince Tamamlandı', 'Firma Yönetimi Müdür Yardımcısı', ARRAY['Tamamlandı']::text[], false, false, 'Denetçiye görev', NULL),
  ('firma_denetim_plani', 'Tamamlandı', 'Kayıttaki iş bitti; gerekli kayıtlar oluştu.', 'Denetçi sonucu kaydedince', 'Son durum; değişmez', 'Firma Yönetimi Müdür Yardımcısı', '{}'::text[], false, false, NULL, NULL)
ON CONFLICT DO NOTHING;
