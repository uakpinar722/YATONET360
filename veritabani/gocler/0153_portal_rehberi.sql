-- YG-1396, Cilt VIII ¶1048: Çözüm Ortağı kullanıcısı portal rehberini okudum, anladım beyanı vermeden işlem yapamaz (Alan Sözlüğü kullanici_hesabi.portal_rehberi_beyani).
ALTER TABLE kullanici_hesabi ADD COLUMN portal_rehberi_beyani timestamptz;
