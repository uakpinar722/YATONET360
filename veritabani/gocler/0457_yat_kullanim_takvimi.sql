-- YG-106: Yat Kullanım Takvimi; Dosya Sorumlusunun girdiği kullanım dönemleri (sistem satırları dosya ve yat kayıtlarından türetilir).
CREATE TABLE yat_kullanim_donemi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yat_ref uuid NOT NULL REFERENCES yat (kimlik), tur text NOT NULL CHECK (tur IN ('Kullanım', 'Kiralama', 'Kışlama', 'Onarım Penceresi', 'Yat Erişilemez')),
  baslangic date NOT NULL, bitis date NOT NULL, konum text, aciklama text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), CHECK (bitis >= baslangic)
);
CREATE INDEX yat_kullanim_donemi_yat ON yat_kullanim_donemi (yat_ref, baslangic);
GRANT SELECT, INSERT ON yat_kullanim_donemi TO yatonet_uygulama;
