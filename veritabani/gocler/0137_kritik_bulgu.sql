-- YG-545: keşifte kritik bulgu bildirimi; alıcı, bilgi ve karar kaydı.
CREATE TABLE kritik_bulgu_bildirimi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), bulgu_ref uuid NOT NULL UNIQUE REFERENCES bulgu (kimlik), alicilar text[] NOT NULL, bilgi text NOT NULL, bildiren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), karar text, karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz);
GRANT SELECT, INSERT, UPDATE ON kritik_bulgu_bildirimi TO yatonet_uygulama;
