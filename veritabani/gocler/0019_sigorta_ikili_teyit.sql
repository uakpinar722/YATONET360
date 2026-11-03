-- K-241: sigorta şirketine giden her ileti ve belge, son gönderenin iki ayrı teyidi olmadan çıkmaz. LMT-1: poliçe olay başı limiti CEO güncelleyene kadar 1.000.000,00 EUR.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('police_olay_basi_limit_eur', 1000000, 'Tamirci sorumluluk poliçesi olay başı limiti (LMT-1)'),
  ('sigorta_teyit_bekleme_sn', 2, 'İki teyit arasında en az süre')
ON CONFLICT (kod) DO UPDATE SET deger = EXCLUDED.deger;
CREATE TABLE sigorta_gonderim (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid REFERENCES dosya (kimlik), tur text NOT NULL, nesne_kimligi text NOT NULL, alici text, konu text NOT NULL, metin text, acil boolean NOT NULL DEFAULT false, veri jsonb NOT NULL DEFAULT '{}',
  sorumlu_ref text REFERENCES kullanici_hesabi (kimlik), durum text NOT NULL DEFAULT 'Teyit Bekliyor' CHECK (durum IN ('Teyit Bekliyor', 'Birinci Teyit', 'Gönderildi', 'İptal')),
  birinci_teyit_ref text REFERENCES kullanici_hesabi (kimlik), birinci_teyit_zamani timestamptz, ikinci_teyit_zamani timestamptz, iptal_gerekcesi text, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sigorta_gonderim_tek ON sigorta_gonderim (tur, nesne_kimligi) WHERE durum IN ('Teyit Bekliyor', 'Birinci Teyit');
CREATE INDEX sigorta_gonderim_dosya ON sigorta_gonderim (dosya_ref, durum);
GRANT SELECT, INSERT, UPDATE ON sigorta_gonderim TO yatonet_uygulama;
