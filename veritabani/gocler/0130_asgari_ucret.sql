-- YG-1082: asgari ücret İK Müdürünün girdiği resmî tutardır.
ALTER TABLE ik_parametresi DROP CONSTRAINT IF EXISTS ik_parametresi_kod_check;
ALTER TABLE ik_parametresi ADD CONSTRAINT ik_parametresi_kod_check CHECK (kod IN ('kidem_tavani_tl', 'harcirah_gunluk_eur', 'damga_vergisi_binde', 'asgari_ucret_brut_tl'));
