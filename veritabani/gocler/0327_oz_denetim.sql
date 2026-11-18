-- YG-1652: Sistem Öz Denetimi. Her çalışma ayrı sentetik veritabanında beş süreçten beş senaryo dener; sonuç ve bulgular burada tutulur.
CREATE TABLE oz_denetim_calismasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), calisma_no text NOT NULL UNIQUE,
  tur text NOT NULL CHECK (tur IN ('Zamanlanmış', 'Sürüm Öncesi', 'Kural Değişikliği')), yayin_ref uuid REFERENCES yayin_seti (kimlik),
  sonuc text NOT NULL DEFAULT 'Sürüyor' CHECK (sonuc IN ('Sürüyor', 'Başarılı', 'Başarısız', 'Çalıştırılamadı')), aciklama text,
  baslatan_ref text REFERENCES kullanici_hesabi (kimlik), baslangic timestamptz NOT NULL DEFAULT now(), bitis timestamptz
);
CREATE TABLE oz_denetim_sonucu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), calisma_ref uuid NOT NULL REFERENCES oz_denetim_calismasi (kimlik),
  senaryo_kodu text NOT NULL, surec text NOT NULL, ad text NOT NULL, senaryo_turu text NOT NULL, beklenen text NOT NULL, gerceklesen text NOT NULL,
  basarili boolean NOT NULL, dongu integer NOT NULL, bulgu_ref uuid REFERENCES sistem_bulgusu (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oz_denetim_sonucu_calisma ON oz_denetim_sonucu (calisma_ref);
-- Başarısız senaryo sabit test setine eklenir; sürüm öncesi çalışmada her zaman denenir.
CREATE TABLE oz_denetim_sabit_set (senaryo_kodu text PRIMARY KEY, ilk_calisma_ref uuid NOT NULL REFERENCES oz_denetim_calismasi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON oz_denetim_calismasi, oz_denetim_sonucu TO yatonet_uygulama;
GRANT SELECT, INSERT ON oz_denetim_sabit_set TO yatonet_uygulama;
-- Canlı kullanım başlangıcı (YYYYAAGG); 0 iken zamanlanmış çalışma yapılmaz, sürüm öncesi ve elle çalışma yapılır.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('oz_denetim_baslangic', 0, 'Sistem öz denetimi sıklığının hesaplandığı canlı kullanım başlangıç tarihi (YYYYAAGG); 0 ise zamanlanmış çalışma kapalı')
ON CONFLICT (kod) DO NOTHING;
