-- TAT-1 (CEO onayı 06.11.2026): 2026 ve 2027 resmî tatil ve arife takvimi (2429 sayılı Kanun; bayram tarihleri). Sonraki yıllar Kasımda ekrandan girilir.
INSERT INTO resmi_tatil (tarih, ad, yarim_gun) VALUES
 ('2026-01-01','Yılbaşı',false),('2026-03-19','Ramazan Bayramı Arifesi',true),('2026-03-20','Ramazan Bayramı 1. Gün',false),('2026-03-21','Ramazan Bayramı 2. Gün',false),('2026-03-22','Ramazan Bayramı 3. Gün',false),
 ('2026-04-23','Ulusal Egemenlik ve Çocuk Bayramı',false),('2026-05-01','Emek ve Dayanışma Günü',false),('2026-05-19','Atatürk''ü Anma, Gençlik ve Spor Bayramı',false),
 ('2026-05-26','Kurban Bayramı Arifesi',true),('2026-05-27','Kurban Bayramı 1. Gün',false),('2026-05-28','Kurban Bayramı 2. Gün',false),('2026-05-29','Kurban Bayramı 3. Gün',false),('2026-05-30','Kurban Bayramı 4. Gün',false),
 ('2026-07-15','Demokrasi ve Millî Birlik Günü',false),('2026-08-30','Zafer Bayramı',false),('2026-10-28','Cumhuriyet Bayramı Arifesi',true),('2026-10-29','Cumhuriyet Bayramı',false),
 ('2027-01-01','Yılbaşı',false),('2027-03-08','Ramazan Bayramı Arifesi',true),('2027-03-09','Ramazan Bayramı 1. Gün',false),('2027-03-10','Ramazan Bayramı 2. Gün',false),('2027-03-11','Ramazan Bayramı 3. Gün',false),
 ('2027-04-23','Ulusal Egemenlik ve Çocuk Bayramı',false),('2027-05-01','Emek ve Dayanışma Günü',false),('2027-05-15','Kurban Bayramı Arifesi',true),('2027-05-16','Kurban Bayramı 1. Gün',false),('2027-05-17','Kurban Bayramı 2. Gün',false),
 ('2027-05-18','Kurban Bayramı 3. Gün',false),('2027-05-19','Kurban Bayramı 4. Gün; Atatürk''ü Anma, Gençlik ve Spor Bayramı',false),('2027-07-15','Demokrasi ve Millî Birlik Günü',false),('2027-08-30','Zafer Bayramı',false),
 ('2027-10-28','Cumhuriyet Bayramı Arifesi',true),('2027-10-29','Cumhuriyet Bayramı',false)
ON CONFLICT (tarih) DO NOTHING;
