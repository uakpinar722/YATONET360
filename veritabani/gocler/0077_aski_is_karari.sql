-- YG-1660: geçici askıdaki firmanın her açık iş emri için ayrı karar (Güvenli Durdurma, Kontrollü Devam, Ek Gözetim, Devir); öneri öndeğer olarak gelir.
CREATE TABLE IF NOT EXISTS aski_is_karari (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik),
  oneri text NOT NULL CHECK (oneri IN ('Güvenli Durdurma', 'Kontrollü Devam', 'Ek Gözetim', 'Devir')), karar text CHECK (karar IN ('Güvenli Durdurma', 'Kontrollü Devam', 'Ek Gözetim', 'Devir')),
  gerekce text, karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS aski_is_karari_acik ON aski_is_karari (is_emri_ref) WHERE karar IS NULL;
GRANT SELECT, INSERT, UPDATE ON aski_is_karari TO yatonet_uygulama;
