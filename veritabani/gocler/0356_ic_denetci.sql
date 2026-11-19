-- YG-1671 (A47): iç denetim kanıtları, kanıt talepleri ve örneklem incelemesi (FR-KLT-011 denetim bulguları alanı).
CREATE TABLE ic_denetim_kanit (
  kimlik bigserial PRIMARY KEY, denetim_ref uuid NOT NULL REFERENCES ic_denetim (kimlik), tur text NOT NULL CHECK (tur IN ('Belge', 'Kayıt', 'Gözlem', 'Ölçüm', 'Yetkili Görüşme')),
  aciklama text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ic_denetim_kanit_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), denetim_ref uuid NOT NULL REFERENCES ic_denetim (kimlik), istenen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), konu text NOT NULL, son_tarih date NOT NULL,
  yanit text, yanit_zamani timestamptz, isteyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ic_denetim_orneklemi ADD COLUMN inceleme_sonucu text CHECK (inceleme_sonucu IN ('Uygun', 'Bulgulu')), ADD COLUMN bulgu_sinif text CHECK (bulgu_sinif IN ('Gözlem', 'Minör', 'Majör', 'Kritik')),
  ADD COLUMN bulgu_kanit text, ADD COLUMN bulgu_sorumlu text, ADD COLUMN bulgu_hedef date, ADD COLUMN inceleme_zamani timestamptz;
GRANT SELECT, INSERT ON ic_denetim_kanit TO yatonet_uygulama; GRANT USAGE ON SEQUENCE ic_denetim_kanit_kimlik_seq TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON ic_denetim_kanit_talebi TO yatonet_uygulama; GRANT UPDATE ON ic_denetim_orneklemi TO yatonet_uygulama;
