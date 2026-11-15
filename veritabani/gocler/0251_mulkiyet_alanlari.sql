-- YG-477: lehtar ve mülkiyet türü dış kullanıcı gruplarından gizlenir.
INSERT INTO alan_erisim_kurali (alan, davranis, yasak_gruplar, yalniz_roller, aciklama) VALUES
  ('lehtar_adi', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis,Sigorta,Broker}', '{}', 'YG-477'),
  ('mulkiyet_turu', 'Gizle', '{İş Birliği Firması,Tedarikçi,Tesis,Sigorta,Broker}', '{}', 'YG-477')
ON CONFLICT (alan) DO NOTHING;
