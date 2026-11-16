-- YG-1367, PRM-1 (CEO 16.11.2026): yazdıkça öneren arama 10 kayıt; liste, filtre ve dışa aktarım 50 kayıt; tamamlanmamış taslak 90 gün.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('arama_oneri_azami', 10, 'Yazdıkça öneren aramada gösterilen en çok kayıt'),
  ('liste_azami', 50, 'Liste, filtre ve dışa aktarımda en çok kayıt'),
  ('taslak_silme_gun', 90, 'Tamamlanmamış taslak kaydın silinme süresi (gün)')
ON CONFLICT (kod) DO NOTHING;
