-- YG-1667, YG-1668, TZ-7 (CEO 26.11.2026): firma kapasitesi doluyken istisna; Teknik ve Operasyon Direktörü 24 saat içinde üç seçenekten biriyle karar verir.
CREATE TABLE kapasite_istisnasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik),
  gerekce text NOT NULL, talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), talep_zamani timestamptz NOT NULL DEFAULT now(),
  secenek text CHECK (secenek IN ('Ek Kaynak veya Alt Yükleniciyle Kabul', 'Hedef Süre Uzatılarak Kabul', 'Başka Çözüm Ortağına Yönlendirme')),
  karar_aciklamasi text, yeni_hedef_tarih date, karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz
);
CREATE UNIQUE INDEX kapasite_istisnasi_acik ON kapasite_istisnasi (dosya_ref, kurulus_ref) WHERE secenek IS NULL;
GRANT SELECT, INSERT, UPDATE ON kapasite_istisnasi TO yatonet_uygulama;
