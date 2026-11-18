-- YG-1544: VERBİS kayıt eşikleri (Kurul kararıyla değişirse parametre) ve yıllık mali bilanço toplamı (muhasebe hizmetinden).
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('verbis_calisan_esigi', 50, 'VERBİS kayıt eşiği: yıllık ortalama çalışan sayısı'),
  ('verbis_bilanco_esigi_tl', 100000000, 'VERBİS kayıt eşiği: yıllık mali bilanço toplamı (TL)')
ON CONFLICT (kod) DO NOTHING;
CREATE TABLE yillik_bilanco (
  yil integer PRIMARY KEY CHECK (yil BETWEEN 2020 AND 2100),
  toplam_tl numeric(18,2) NOT NULL CHECK (toplam_tl >= 0),
  giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON yillik_bilanco TO yatonet_uygulama;
