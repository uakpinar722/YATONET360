-- YG-632: ayrı tablosu olmayan Ek II araçlarının kaydı; ekran ve doğrulama alan sözlüğünden üretilir. FR-KLT-015 kabul matrisi satırı KMnn numarası taşır.
CREATE TABLE form_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_no text NOT NULL UNIQUE, form_kodu text NOT NULL REFERENCES form_katalogu (kod), form_surumu integer NOT NULL,
  dosya_ref uuid REFERENCES dosya (kimlik), is_emri_ref uuid REFERENCES is_emri (kimlik), kurulus_ref uuid REFERENCES kurulus (kimlik), veriler jsonb NOT NULL DEFAULT '{}',
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kontrolde', 'Onaylı')), iade_nedeni text,
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_kaydi_dosya ON form_kaydi (dosya_ref);
CREATE INDEX form_kaydi_is_emri ON form_kaydi (is_emri_ref);
GRANT SELECT, INSERT, UPDATE ON form_kaydi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('form_kaydi', 'Açık', 'Kayıt üzerinde çalışma sürüyor; kapanış koşulları henüz sağlanmadı.', 'Form kaydı açılınca veya kontrolde iade edilince', 'Hazırlayan kontrole gönderince Kontrolde; onaylayan tanımlı değilse Onaylı', 'Katalogdaki dolduran rol', ARRAY['Kontrolde', 'Onaylı']::text[], false, false, NULL, NULL),
 ('form_kaydi', 'Kontrolde', 'Kayıt yetkili kişinin kontrolünde; sonuç bekleniyor.', 'Hazırlayan kontrole gönderince', 'Onaylayan onaylarsa Onaylı, iade ederse Açık', 'Katalogdaki onaylayan rol', ARRAY['Onaylı', 'Açık']::text[], false, false, 'Onaylayan role onay kartı', NULL),
 ('form_kaydi', 'Onaylı', 'Kayıt yetkili makamca onaylanmış durumda.', 'Onaylayan onaylayınca', 'Son durum; düzeltme yeni kayıtla', 'Katalogdaki onaylayan rol', '{}'::text[], false, false, NULL, NULL);
UPDATE form_katalogu SET sistem_karsiligi = 'form_kaydi (alan sözlüğünden üretilen ekran)' WHERE kod = ANY(ARRAY['FR-ONR-003', 'FR-ONR-004', 'FR-ONR-007', 'FR-ONR-008', 'FR-ONR-009', 'FR-MLZ-001', 'FR-MLZ-005', 'FR-MLZ-008', 'FR-UYG-006', 'FR-KLT-013']);
ALTER TABLE gereklilik_satiri ADD COLUMN km_no text;
UPDATE gereklilik_satiri g SET km_no = 'KM' || lpad(x.n::text, 2, '0') FROM (SELECT kimlik, row_number() OVER (PARTITION BY plan_ref ORDER BY kimlik) n FROM gereklilik_satiri) x WHERE x.kimlik = g.kimlik;
UPDATE form_katalogu SET sistem_karsiligi = 'gereklilik_satiri (KMnn) · kalite.ts' WHERE kod = 'FR-KLT-015';
