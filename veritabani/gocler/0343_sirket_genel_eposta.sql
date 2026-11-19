-- CEO 19.11.2026: genel e-posta adresi (sosyal medya Genel yanıt şablonu FR-KLT-017-1 ve iletişim alanları).
INSERT INTO sirket_bilgisi (anahtar, deger) VALUES ('genel_eposta', 'info@limitglobalmarine.com.tr') ON CONFLICT (anahtar) DO UPDATE SET deger = EXCLUDED.deger;
