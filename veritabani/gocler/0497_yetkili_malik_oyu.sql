-- YG-1463 (V-1128): paylı yatta maliklerin SMS kodlu yetkili malik seçimi; yeni turda eski oylar geçersiz sayılır (silinmez).
CREATE TABLE yetkili_malik_oyu (
  kimlik bigserial PRIMARY KEY, yat_ref uuid NOT NULL REFERENCES yat (kimlik), malik_ref uuid NOT NULL REFERENCES yat_malik (kimlik), secilen_ref uuid NOT NULL REFERENCES yat_malik (kimlik),
  onay_ref uuid REFERENCES onay_talebi (kimlik), gecerli boolean NOT NULL DEFAULT true, zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON yetkili_malik_oyu TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE yetkili_malik_oyu_kimlik_seq TO yatonet_uygulama;
ALTER TABLE onay_talebi ADD COLUMN secenekler jsonb;
