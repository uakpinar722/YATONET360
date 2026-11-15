-- YG-1182: güvenlik istisnasını veren kişi.
ALTER TABLE guvenlik_kural ADD COLUMN istisna_veren_ref text;
