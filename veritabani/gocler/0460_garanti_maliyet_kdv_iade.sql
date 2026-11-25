-- YG-899 (CEO 25.11.2026 alan tanımlarını yap): Garanti Maliyet Kaydı, Üretici Garanti Başvurusu, KDV İade Dosyası.
CREATE TABLE garanti_maliyet_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), garanti_ref uuid REFERENCES garanti_sikayet (kimlik), is_emri_ref uuid REFERENCES is_emri (kimlik),
  kalem text NOT NULL CHECK (kalem IN ('İşçilik', 'Parça', 'Malzeme', 'Ulaşım', 'Diğer')), tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0),
  karsilayan text NOT NULL CHECK (karsilayan IN ('Çözüm Ortağı', 'Tedarikçi', 'Üretici', 'LGM')), mahsup_referansi text, belge_ref uuid REFERENCES belge (kimlik), aciklama text,
  durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz,
  CHECK (karsilayan = 'LGM' OR mahsup_referansi IS NOT NULL)
);
CREATE TABLE uretici_garanti_basvurusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), basvuru_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), marka text NOT NULL, model text, seri_no text, parca_no text,
  ariza_tanimi text NOT NULL, ariza_tarihi date NOT NULL, garanti_bitis date, uretici text NOT NULL, basvuru_tarihi date, kanal text CHECK (kanal IN ('E-posta', 'Üretici Portalı', 'Yetkili Servis', 'Posta', 'Diğer')),
  uretici_referans_no text, ekler uuid[] NOT NULL DEFAULT '{}',
  durum text NOT NULL DEFAULT 'Hazırlanıyor' CHECK (durum IN ('Hazırlanıyor', 'Gönderildi', 'Üretici İncelemesinde', 'Kabul', 'Kısmi Kabul', 'Ret')),
  karar_tarihi date, karsilanan_eur numeric(14,2) CHECK (karsilanan_eur >= 0), sonuc_notu text, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kdv_iade_dosyasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), donem text NOT NULL CHECK (donem ~ '^[0-9]{4}-[0-9]{2}$'), iade_nedeni text, fatura_refler uuid[] NOT NULL DEFAULT '{}', iade_tutari_tl numeric(14,2) NOT NULL CHECK (iade_tutari_tl > 0),
  dayanak_belgeler uuid[] NOT NULL DEFAULT '{}', mali_musavire_gonderim date, vergi_dairesi_basvuru_no text, sonuc_tutari_tl numeric(14,2) CHECK (sonuc_tutari_tl >= 0),
  durum text NOT NULL DEFAULT 'Hazırlanıyor' CHECK (durum IN ('Hazırlanıyor', 'Mali Müşavirde', 'Başvuruldu', 'Sonuçlandı')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON garanti_maliyet_kaydi, uretici_garanti_basvurusu, kdv_iade_dosyasi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('garanti_maliyet_kaydi', 'Onay Bekliyor', 'Kayıt hazırlandı, yetkili makamın onayını bekliyor.', 'Ticari Sorumlu garanti işinin maliyet kalemini ve karşılayan tarafı girince', 'Ticari İşler Direktörü kararıyla Onaylandı veya Reddedildi', 'Ticari İşler Direktörü', ARRAY['Onaylandı', 'Reddedildi'], false, false, 'Onay kartı', NULL),
  ('garanti_maliyet_kaydi', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Ticari İşler Direktörü onaylayınca', 'Yok', 'Ticari İşler Direktörü', '{}'::text[], false, false, NULL, NULL),
  ('garanti_maliyet_kaydi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Onay zincirinde reddedilince', 'Yok', 'Ticari İşler Direktörü', '{}'::text[], true, false, NULL, NULL),
  ('uretici_garanti_basvurusu', 'Hazırlanıyor', 'Kayıt hazırlanıyor; henüz üreticiye gönderilmedi.', 'Dosya Sorumlusu ekipman ve arıza bilgileriyle başvuru açınca', 'Gönderim tarihi ve kanalıyla Gönderildi', 'Dosya Sorumlusu', ARRAY['Gönderildi'], false, false, NULL, NULL),
  ('uretici_garanti_basvurusu', 'Gönderildi', 'Başvuru üreticiye veya yetkili servisine gönderildi.', 'Başvuru tarihi ve kanalı girilince', 'Üretici incelemeye alınca veya karar verince', 'Dosya Sorumlusu', ARRAY['Üretici İncelemesinde', 'Kabul', 'Kısmi Kabul', 'Ret'], false, false, NULL, NULL),
  ('uretici_garanti_basvurusu', 'Üretici İncelemesinde', 'Başvuru üretici tarafından inceleniyor.', 'Üretici referans numarası veya inceleme bildirimi gelince', 'Üretici kararıyla Kabul, Kısmi Kabul veya Ret', 'Dosya Sorumlusu', ARRAY['Kabul', 'Kısmi Kabul', 'Ret'], false, false, NULL, NULL),
  ('uretici_garanti_basvurusu', 'Kabul', 'Üretici başvuruyu kabul etti.', 'Karar tarihi ve karşılanan tutarla', 'Yok', 'Dosya Sorumlusu', '{}'::text[], false, false, NULL, NULL),
  ('uretici_garanti_basvurusu', 'Kısmi Kabul', 'Üretici başvuruyu kısmen kabul etti.', 'Karar tarihi, karşılanan tutar ve sonuç notuyla', 'Yok', 'Dosya Sorumlusu', '{}'::text[], true, false, NULL, NULL),
  ('uretici_garanti_basvurusu', 'Ret', 'Üretici başvuruyu kabul etmedi; gerekçe kayıtlıdır.', 'Karar tarihi ve sonuç notuyla', 'Yok', 'Dosya Sorumlusu', '{}'::text[], true, false, NULL, NULL),
  ('kdv_iade_dosyasi', 'Hazırlanıyor', 'Kayıt hazırlanıyor.', 'Muhasebe ve Finans dönem, faturalar ve iade tutarıyla dosya açınca', 'Mali müşavire gönderim tarihiyle Mali Müşavirde', 'Muhasebe ve Finans Müdürü', ARRAY['Mali Müşavirde'], false, false, NULL, NULL),
  ('kdv_iade_dosyasi', 'Mali Müşavirde', 'Dosya mali müşavirin incelemesinde.', 'Gönderim tarihi girilince', 'Vergi dairesi başvuru numarasıyla Başvuruldu', 'Muhasebe ve Finans Müdürü', ARRAY['Başvuruldu'], false, false, NULL, NULL),
  ('kdv_iade_dosyasi', 'Başvuruldu', 'İade talebi vergi dairesine başvuruldu.', 'Başvuru numarası girilince', 'Sonuç tutarıyla Sonuçlandı', 'Muhasebe ve Finans Müdürü', ARRAY['Sonuçlandı'], false, false, NULL, NULL),
  ('kdv_iade_dosyasi', 'Sonuçlandı', 'İade talebi sonuçlandı; sonuç tutarı kayıtlıdır.', 'Sonuç tutarı girilince', 'Yok', 'Muhasebe ve Finans Müdürü', '{}'::text[], false, false, NULL, NULL)
ON CONFLICT DO NOTHING;
