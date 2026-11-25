-- YG-1611 (YG-1080 ile uzlaştırma, CEO 25.11.2026): Muhasebe ve Finans Müdür Yardımcısı eşleşmeyen banka hareketini cariye eşleştirir; bakiye ve toplamlar dört role kapalı kalır.
ALTER TABLE hesap_hareketi ADD COLUMN eslestiren_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN eslesme_zamani timestamptz;
GRANT UPDATE (cari_turu, cari_ref, eslestiren_ref, eslesme_zamani) ON hesap_hareketi TO yatonet_uygulama;
