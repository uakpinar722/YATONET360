-- CEO 06.11.2026: yıllık bilanço ve bütçe dönemi (Kasım başı açılış, Aralık 2. hafta nihai onay).
INSERT INTO toplanti_katalogu VALUES
  ('TPL-11', 'Bilanço ve Bütçe Koordinasyonu', 'Yıllık (Kasım–Aralık, üç toplantı)', NULL, 'Muhasebe ve Finans Müdürü', 'CEO (açılışta), GMY, direktörler, Muhasebe ve Finans Müdürü; talep toplantısında İnsan Kaynakları ve Bilgi İşlem Müdürleri', '{Genel Müdür Yardımcısı,Muhasebe ve Finans Müdürü}', '{Direktör}', false),
  ('TPL-12', 'Bütçe Nihai Onay', 'Yıllık (Aralık 2. hafta)', 'CEO', 'Muhasebe ve Finans Müdürü', 'GMY, direktörler, Muhasebe ve Finans Müdürü', '{CEO,Genel Müdür Yardımcısı,Muhasebe ve Finans Müdürü}', '{Direktör}', false)
ON CONFLICT (kod) DO NOTHING;
CREATE TABLE butce_donemi (yil integer PRIMARY KEY, durum text NOT NULL DEFAULT 'Hazırlık' CHECK (durum IN ('Hazırlık', 'Onaylandı')), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, karar_notu text, acilis_zamani timestamptz NOT NULL DEFAULT now());
CREATE TABLE butce_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yil integer NOT NULL REFERENCES butce_donemi (yil), birim text NOT NULL, kategori text NOT NULL, aciklama text NOT NULL, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), gerekce text NOT NULL, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON butce_donemi TO yatonet_uygulama; GRANT SELECT, INSERT ON butce_talebi TO yatonet_uygulama;
