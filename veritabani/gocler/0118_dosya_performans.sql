-- YG-785, YG-786: FR-KLT-011 Dosya Performans Değerlendirmesi; dosya başına bir kayıt.
CREATE TABLE dosya_performans (
  dosya_ref uuid PRIMARY KEY REFERENCES dosya (kimlik), sapma_nedeni text NOT NULL, denetim_sinifi text, denetim_bulgulari text NOT NULL, firma_karne_etkisi text NOT NULL, degerlendiren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'İade')), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON dosya_performans TO yatonet_uygulama;
