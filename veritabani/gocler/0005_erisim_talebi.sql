-- Erişim talebi ve rol atama. YG-1005, YG-1008, YG-1009, YG-1040, YG-1042, YG-1643.
CREATE TABLE kayit_sayaci (
  on_ek text NOT NULL,
  yil   integer NOT NULL,
  sayi  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (on_ek, yil)
);

CREATE TABLE erisim_talebi (
  kimlik                    text PRIMARY KEY CHECK (kimlik ~ '^ERS-[0-9]{4}-[0-9]{4,}$'),
  olusturma_zamani          timestamptz NOT NULL DEFAULT now(),
  talep_eden_ref            text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  kullanici_ref             text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  rol_ref                   text NOT NULL REFERENCES rol (kimlik),
  is_gerekcesi              text NOT NULL CHECK (length(trim(is_gerekcesi)) > 0),
  kapsam                    text NOT NULL CHECK (length(trim(kapsam)) > 0),
  sure_sonu                 date NOT NULL,
  is_onayi_veren            text REFERENCES kullanici_hesabi (kimlik),
  is_onayi_zamani           timestamptz,
  teknik_atama_zamani       timestamptz,
  teknik_atayan             text REFERENCES kullanici_hesabi (kimlik),
  kullanici_bildirim_zamani timestamptz,
  izin_dogrulandi           boolean,
  is_karti_ref              uuid REFERENCES is_karti (kimlik),
  talep_asamasi             text NOT NULL DEFAULT 'İş Onayı' CHECK (talep_asamasi IN ('Başvuru', 'İş Onayı', 'Teknik Atama', 'Bildirim', 'Reddedildi', 'İade Edildi'))
);

ALTER TABLE rol_atamasi ADD COLUMN erisim_talebi_ref text REFERENCES erisim_talebi (kimlik);
ALTER TABLE rol_atamasi ADD COLUMN izin_dogrulandi boolean;

GRANT SELECT, INSERT, UPDATE ON kayit_sayaci, erisim_talebi TO yatonet_uygulama;
