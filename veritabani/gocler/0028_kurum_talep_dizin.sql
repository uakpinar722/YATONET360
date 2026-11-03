-- Türkçe yerel ayarda lower('I') 'ı' verir; e-posta karşılaştırması C harmanlamasıyla yapılır.
DROP INDEX kurum_talep_tek;
CREATE UNIQUE INDEX kurum_talep_tek ON kurum_kullanici_talebi (lower(eposta COLLATE "C")) WHERE durum = 'Teyit Bekliyor';
