-- YG-103 (V-1117): Mülkiyet Beyanını verenin sıfatı; leasingde kiracı, malik ayrı kayıt (yat_malik).
ALTER TABLE yat ADD COLUMN beyan_eden_sifati text CHECK (beyan_eden_sifati IN ('Malik', 'Kiracı', 'Kullanan'));
