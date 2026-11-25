-- YG-1537: ad farkı teyit listesi; ana veri modeline bağlanmamış katalog kayıtları (LGM-2026-012 Word serisi) ve sistemce önerilen aday modeller.
CREATE TABLE katalog_ad_farki (
  katalog_seri integer NOT NULL, katalog_no integer NOT NULL, katalog_adi text NOT NULL, adaylar jsonb NOT NULL DEFAULT '[]',
  sonuc text NOT NULL DEFAULT 'Teyit Bekliyor' CHECK (sonuc IN ('Teyit Bekliyor', 'Eşleştirildi', 'Eşleşme Yok')), model_ref uuid REFERENCES yat_marka_model (kimlik),
  teyit_eden_ref text REFERENCES kullanici_hesabi (kimlik), teyit_zamani timestamptz, teyit_notu text, yukleme_zamani timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (katalog_seri, katalog_no)
);
GRANT SELECT, INSERT, UPDATE ON katalog_ad_farki TO yatonet_uygulama;
GRANT UPDATE (katalog_seri, katalog_no, durum, guncelleme_zamani) ON yat_marka_model TO yatonet_uygulama;
