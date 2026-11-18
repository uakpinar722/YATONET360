-- YG-1560: giriş ekranından Çözüm Ortağı başvurusu kurumsal iletişim talebiyle aynı kuyruğa (Firma Yönetimi Müdürü) düşer.
ALTER TABLE kurum_talebi DROP CONSTRAINT kurum_talebi_kurum_turu_check;
ALTER TABLE kurum_talebi ADD CONSTRAINT kurum_talebi_kurum_turu_check CHECK (kurum_turu IN ('Sigorta Şirketi', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Kurumsal Müşteri', 'Marina / Tersane / Çekek Sahası', 'Tedarikçi', 'Çözüm Ortağı Adayı'));
