-- YG-1701 (A53-Z1): şikâyette Teknik Yöneticiden teknik görüş; görüş onay kademesi değildir, şikâyet kaydına bağlanır.
CREATE TABLE sikayet_teknik_gorus (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_ref uuid NOT NULL REFERENCES garanti_sikayet (kimlik),
  soru text NOT NULL CHECK (length(trim(soru)) > 0), isteyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), atanan_ref text REFERENCES kullanici_hesabi (kimlik),
  gorus text, veren_ref text REFERENCES kullanici_hesabi (kimlik), istem_zamani timestamptz NOT NULL DEFAULT now(), gorus_zamani timestamptz
);
CREATE UNIQUE INDEX sikayet_teknik_gorus_acik ON sikayet_teknik_gorus (kayit_ref) WHERE gorus IS NULL;
GRANT SELECT, INSERT, UPDATE ON sikayet_teknik_gorus TO yatonet_uygulama;
