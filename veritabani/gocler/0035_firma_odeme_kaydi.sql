-- YG-830: onaylı firma ödeme talimatının bankada ödendiği kaydedilir; hazırlayan, onaylayan ve ödeyen farklı kişidir.
ALTER TABLE odeme_talimati ADD COLUMN odeyen_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN odeme_zamani timestamptz, ADD COLUMN banka_referansi text;
CREATE UNIQUE INDEX odeme_talimati_banka_referansi ON odeme_talimati (banka_referansi) WHERE banka_referansi IS NOT NULL;
