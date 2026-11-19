-- YG-271: çerçeve sözleşmesiz acil sağlayıcı kullanımı yalnız can veya çevre riskinde, Teknik ve Operasyon Direktörü onayıyla (dosya başına).
CREATE TABLE acil_cercevesiz_onay (dosya_ref uuid PRIMARY KEY REFERENCES dosya (kimlik), onaylayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), gerekce text NOT NULL, zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON acil_cercevesiz_onay TO yatonet_uygulama;
