-- YG-1758: sigorta kullanıcısı şirket siciline TSB koduyla bağlanır; mevcut kayıtlar tam unvanla eşlenir.
ALTER TABLE sigorta_kullanici ADD COLUMN tsb_kodu text REFERENCES sigorta_sirketi (tsb_kodu);
UPDATE sigorta_kullanici k SET tsb_kodu = s.tsb_kodu FROM sigorta_sirketi s WHERE k.tsb_kodu IS NULL AND lower(s.tam_unvan) = lower(k.sigortaci_adi);
GRANT UPDATE ON sigorta_kullanici TO yatonet_uygulama;
