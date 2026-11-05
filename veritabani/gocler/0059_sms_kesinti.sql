-- ALT-5: SMS gönderilemeyince onay kodu e-postayla istenebilir.
ALTER TABLE onay_talebi ADD COLUMN sms_hata_zamani timestamptz;
