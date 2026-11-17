-- YG-176 (KS-8, CEO 17.11.2026): Ara Kademesiz Dönem; 1 açık, 0 kapalı. Yalnız CEO açar ve kapatır.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('ara_kademesiz_donem', 0, 'Ara Kademesiz Dönem (1 açık, 0 kapalı)') ON CONFLICT (kod) DO NOTHING;
