-- YG-994: dış kurum kullanıcısının işlem sınırı. Mevcut kullanıcılar tüm işlevlerle başlar; kurum yöneticisi daraltır.
ALTER TABLE kurulus_kullanici ADD COLUMN islevler text[] NOT NULL DEFAULT ARRAY['Teklif ve Mali', 'Saha', 'Kalite', 'Yönetici']
  CHECK (islevler <@ ARRAY['Teklif ve Mali', 'Saha', 'Kalite', 'Yönetici'] AND cardinality(islevler) > 0);
GRANT UPDATE ON kurulus_kullanici TO yatonet_uygulama;
