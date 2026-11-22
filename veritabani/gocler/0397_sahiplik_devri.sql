-- YG-998: modül sahipliği kişi değil rol kimliğiyle tutulur; rol değişiminde sahiplik devri ve devredilen kayıt sayıları kaydedilir.
CREATE TABLE modul_sahipligi (
  modul text PRIMARY KEY CHECK (length(btrim(modul)) > 0), sahip_rol_ref text NOT NULL REFERENCES rol (kimlik),
  guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sahiplik_devri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), eski_rol_ref text NOT NULL REFERENCES rol (kimlik), yeni_rol_ref text NOT NULL REFERENCES rol (kimlik),
  gerekce text NOT NULL CHECK (length(btrim(gerekce)) > 0), izinler_devredildi boolean NOT NULL, sayilar jsonb NOT NULL,
  yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), CHECK (eski_rol_ref <> yeni_rol_ref)
);
GRANT SELECT, INSERT, UPDATE ON modul_sahipligi TO yatonet_uygulama;
GRANT SELECT, INSERT ON sahiplik_devri TO yatonet_uygulama;
GRANT INSERT ON rol_izni TO yatonet_uygulama;
