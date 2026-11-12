-- CEO 12.11.2026: metin değişikliğini Genel Müdür Yardımcısı onaylar, CEO bilgilendirilir.
UPDATE durum_sozlugu SET yetkili_rol = 'Genel Müdür Yardımcısı', cikis_kosulu = replace(cikis_kosulu, 'CEO', 'Genel Müdür Yardımcısı'), otomatik_bildirim = CASE WHEN durum = 'Onayda' THEN 'Genel Müdür Yardımcısına onay kartı; CEO''ya bilgi' ELSE otomatik_bildirim END
 WHERE kayit_turu = 'sablon_metni' AND durum IN ('Onayda', 'Yürürlükte');
UPDATE durum_sozlugu SET giris_kosulu = replace(giris_kosulu, 'CEO', 'Genel Müdür Yardımcısı') WHERE kayit_turu = 'sablon_metni';
