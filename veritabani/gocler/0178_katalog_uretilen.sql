-- Ek II'de "Şablon bekleniyor" görünen ve sistemde üretilen araçlar yürürlüğe alınır (FR-OPS-013 Kurtarma Sonuç Tutanağı, RP-RAP-004 Nihai Kapanış Özeti, RP-TIC-001 Sigorta Mutabakatı).
UPDATE form_katalogu SET durum = 'Yürürlükte', yururluk_tarihi = current_date WHERE kod IN ('FR-OPS-013', 'RP-RAP-004', 'RP-TIC-001') AND durum = 'Taslak';
