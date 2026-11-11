-- YG-1372: işlem araması eş anlamlıları; her iki yönde aranır. Teknik Müdürlük ve Ticari İşler genişletir.
CREATE TABLE islem_es_anlami (terim text NOT NULL, karsilik text NOT NULL, ekleyen_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (terim, karsilik), CHECK (terim <> karsilik));
GRANT SELECT, INSERT ON islem_es_anlami TO yatonet_uygulama;
INSERT INTO islem_es_anlami (terim, karsilik) VALUES ('kesik yatak', 'cutless');
