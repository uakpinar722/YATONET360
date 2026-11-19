-- YG-1697 (A51-S6), K-200: Hukuk ve Uyumun yurt dışı yerel izin kontrolü.
CREATE TABLE yurt_disi_uygunluk (
  dosya_ref uuid PRIMARY KEY REFERENCES dosya (kimlik), liman_marina_izni boolean NOT NULL, calisma_giris_izni boolean NOT NULL, gumruk_gecici_kabul boolean NOT NULL,
  aciklama text, sonuc text NOT NULL CHECK (sonuc IN ('Uygun', 'Uygun Değil')), karar_veren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON yurt_disi_uygunluk TO yatonet_uygulama;
