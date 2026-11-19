-- YG-1702 (A54): sigorta paneli başvuruları ve deneme dosyaları, sigorta şirketi denetim talepleri, kurumsal itibar riski.
CREATE TABLE sigorta_panel_basvurusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tsb_kodu text NOT NULL REFERENCES sigorta_sirketi (tsb_kodu), belgeler text[] NOT NULL DEFAULT '{}',
  durum text NOT NULL DEFAULT 'Hazırlanıyor' CHECK (durum IN ('Hazırlanıyor', 'Gönderildi', 'Deneme Dosyasında', 'Panele Alındı', 'Kabul Edilmedi')),
  deneme_dosyalari uuid[] NOT NULL DEFAULT '{}', not_metni text, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), gonderim_zamani timestamptz, sonuc_zamani timestamptz
);
CREATE TABLE sigorta_denetim_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tsb_kodu text NOT NULL REFERENCES sigorta_sirketi (tsb_kodu), konu text NOT NULL, son_tarih date NOT NULL,
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Hukuk Görüşünde', 'Yanıtlandı')), hukuk_gorusu text, yanit_ozeti text, yanit_zamani timestamptz, yanitlayan_ref text REFERENCES kullanici_hesabi (kimlik),
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kurumsal_itibar_riski (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), konu text NOT NULL, dosya_ref uuid REFERENCES dosya (kimlik), durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'CEO''ya İletildi')),
  bildiren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), iletim_notu text, ileten_ref text REFERENCES kullanici_hesabi (kimlik), iletim_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON sigorta_panel_basvurusu, sigorta_denetim_talebi, kurumsal_itibar_riski TO yatonet_uygulama;
