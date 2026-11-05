-- AK-1a (YG-991, YG-992, YG-1158): hassas alanlar tek tabloda; API çıkışı bu tablodan geçer.
CREATE TABLE alan_erisim_kurali (
  alan text PRIMARY KEY, davranis text NOT NULL CHECK (davranis IN ('Gizle', 'Maskele')), yasak_gruplar text[] NOT NULL DEFAULT '{}', yalniz_roller text[] NOT NULL DEFAULT '{}', aciklama text NOT NULL
);
INSERT INTO alan_erisim_kurali (alan, davranis, yasak_gruplar, yalniz_roller, aciklama) VALUES
  ('tckn', 'Maskele', '{}', '{}', 'Kimlik numarası her yerde maskeli (YG-1164)'),
  ('iban', 'Maskele', '{}', '{Muhasebe ve Finans Sorumlusu (Ticari Sorumlu),Muhasebe ve Finans Yöneticisi,Muhasebe ve Finans Müdür Yardımcısı,Muhasebe ve Finans Müdürü,Ticari İşler Direktörü,Genel Müdür Yardımcısı,CEO,Firma Yetkilisi,Çözüm Ortağı Kullanıcısı,Tedarikçi Kullanıcısı,Tesis Yetkilisi}', 'Banka bilgisi'),
  ('brut_aylik_tl', 'Gizle', '{}', '{İnsan Kaynakları Müdürü,İnsan Kaynakları Sorumlusu,Ticari İşler Direktörü,Genel Müdür Yardımcısı,CEO}', 'Ücret'),
  ('maliyet_eur', 'Gizle', '{Bireysel,Kurumsal Müşteri,Sigorta,Broker,İş Birliği Firması,Tedarikçi,Tesis}', '{}', 'LGM iç maliyeti'),
  ('birim_maliyet_eur', 'Gizle', '{Bireysel,Kurumsal Müşteri,Sigorta,Broker,İş Birliği Firması,Tedarikçi,Tesis}', '{}', 'LGM iç maliyeti'),
  ('firma_bedeli_eur', 'Gizle', '{Bireysel,Kurumsal Müşteri,Sigorta,Broker}', '{}', 'Firma maliyeti müşteriye ve sigortaya gösterilmez (YG-1074)'),
  ('ticari_unvan', 'Gizle', '{Bireysel,Sigorta,Broker}', '{}', 'Firma kimliği müşteriye ve sigortaya gösterilmez (YG-1167)'),
  ('takyidat', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis,Sigorta,Broker}', '{}', 'YG-1174'),
  ('mulkiyet_turu', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis,Sigorta,Broker}', '{}', 'YG-1174'),
  ('lehtar_adi', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis,Broker}', '{}', 'YG-1174'),
  ('sigorta_hasar_dosya_no', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis}', '{}', 'YG-1623'),
  ('sigortaci_adi', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis}', '{}', 'YG-1623'),
  ('police_no', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis}', '{}', 'YG-1623'),
  ('hukuk_karari', 'Gizle', '{Bireysel,Kurumsal Müşteri,Sigorta,Broker,İş Birliği Firması,Tedarikçi,Tesis}', '{}', 'Hukuk notu');
GRANT SELECT ON alan_erisim_kurali TO yatonet_uygulama;
