-- YG-1539 (V-1130): Çözüm Ortağı adaylarında tahmini varış için ortalama yol hızı (km/sa); HZ-3 varsayılanı, değiştirilebilir.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('ortalama_yol_hizi_kmsa', 60, 'Çözüm Ortağı adaylarında kuş uçuşu uzaklıktan tahmini varış süresi hesabında kullanılan ortalama yol hızı (km/sa); YG-1539, V-1130.') ON CONFLICT (kod) DO NOTHING;
