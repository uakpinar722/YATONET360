-- YG-1582, YG-1586: gözetim dosyalarında haftalık gözetim notu (Operasyon Yöneticisi ve Teknik Yönetici); hafta başına rol için tek not, hafta içinde güncellenir.
CREATE TABLE gozetim_notu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  rol text NOT NULL CHECK (rol IN ('Operasyon Yöneticisi', 'Teknik Yönetici')), hafta text NOT NULL, notu text NOT NULL,
  yazan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (dosya_ref, rol, hafta)
);
GRANT SELECT, INSERT, UPDATE ON gozetim_notu TO yatonet_uygulama;
