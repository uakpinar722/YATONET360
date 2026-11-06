-- YG-532: LGM'nin kendi poliçesi, imza sirküleri, broker ve acente yetki belgeleri süre takibi.
CREATE TABLE kurum_belgesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('LGM Sigorta Poliçesi', 'İmza Sirküleri', 'Broker Yetki Belgesi', 'Acente Yetki Belgesi')), ad text NOT NULL, karsi_taraf text, bitis date NOT NULL, belge_ref uuid REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'Geçerli' CHECK (durum IN ('Geçerli', 'Yenilendi')), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON kurum_belgesi TO yatonet_uygulama;
