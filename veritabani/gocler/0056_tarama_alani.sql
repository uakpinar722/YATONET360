-- YG-916: tarama sonucu müşteri kartında yalnız yetkili rollere görünür.
INSERT INTO alan_erisim_kurali (alan, davranis, yasak_gruplar, yalniz_roller, aciklama) VALUES ('tarama_sonucu', 'Gizle', '{}', '{Hukuk ve Uyum Direktörü,Ticari İşler Direktörü,Genel Müdür Yardımcısı,CEO}', 'YG-916');
