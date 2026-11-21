-- YG-986, YG-1365: ortak durum adı tek anlamlıdır; devir kabulü durumu kendi adıyla tutulur.
ALTER TABLE ayrilis_devri DROP CONSTRAINT ayrilis_devri_durum_check;
UPDATE ayrilis_devri SET durum = 'Devralan Kabulünde' WHERE durum = 'Kabul Bekliyor';
ALTER TABLE ayrilis_devri ADD CONSTRAINT ayrilis_devri_durum_check CHECK (durum IN ('Bekliyor', 'Devralan Kabulünde', 'Devredildi', 'Birim Amirine Atandı'));
UPDATE durum_sozlugu SET durum = 'Devralan Kabulünde' WHERE kayit_turu = 'ayrilis_devri' AND durum = 'Kabul Bekliyor';
UPDATE durum_sozlugu SET izinli_gecisler = ARRAY['Devralan Kabulünde','Birim Amirine Atandı']::text[], cikis_kosulu = 'Birim amiri devralanı seçince Devralan Kabulünde; son iş günü geçince sistem Birim Amirine Atandı yapar' WHERE kayit_turu = 'ayrilis_devri' AND durum = 'Bekliyor';
