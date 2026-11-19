-- YG-1651: başvuru ön incelemesinde birim görüşü; Teknik Müdürlük (yetkinlik, personel, tesis, ekipman) ve İSG Sorumlusu (İSG ve çevre). Görüş onay kademesi değildir.
CREATE TABLE firma_birim_gorusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), birim text NOT NULL CHECK (birim IN ('Teknik Müdürlük', 'İSG')),
  sonuc text CHECK (sonuc IN ('Uygun', 'Koşullu', 'Uygun Değil')), gorus_notu text, isteyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), veren_ref text REFERENCES kullanici_hesabi (kimlik),
  istem_zamani timestamptz NOT NULL DEFAULT now(), gorus_zamani timestamptz
);
CREATE UNIQUE INDEX firma_birim_gorusu_acik ON firma_birim_gorusu (kurulus_ref, birim) WHERE sonuc IS NULL;
GRANT SELECT, INSERT, UPDATE ON firma_birim_gorusu TO yatonet_uygulama;
