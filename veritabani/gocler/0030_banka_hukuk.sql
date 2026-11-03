-- YG-1659, K-178: Koşullu Onaylı ve Reddedildi önerisinde Hukuk ve Uyum görüşü; kademe sayılmaz, bağlayıcı değildir.
CREATE TABLE firma_hukuk_gorusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), oneri text NOT NULL CHECK (oneri IN ('Koşullu Onaylı', 'Reddedildi')), gorus text CHECK (gorus IN ('Uygun', 'Uygun Görülmedi')), durum text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Verildi', 'Kullanıldı')), isteyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), veren_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), gorus_zamani timestamptz
);
CREATE UNIQUE INDEX firma_hukuk_tek_acik ON firma_hukuk_gorusu (kurulus_ref, oneri) WHERE durum IN ('Bekliyor', 'Verildi');
GRANT SELECT, INSERT, UPDATE ON firma_hukuk_gorusu TO yatonet_uygulama;
