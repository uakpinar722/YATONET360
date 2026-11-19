-- YG-1687: Kalite Uzmanının yokluğunda dosya bazında yedek kontrolör (¶2537, VK-1).
ALTER TABLE dosya_ekibi_atamasi DROP CONSTRAINT IF EXISTS dosya_ekibi_atamasi_rol_check;
ALTER TABLE dosya_ekibi_atamasi ADD CONSTRAINT dosya_ekibi_atamasi_rol_check CHECK (rol IN ('Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi', 'Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici', 'Saha Sorumlusu', 'Kalite Kontrolör', 'Yedek Kalite Kontrolör', 'Tedarik Sorumlusu'));
