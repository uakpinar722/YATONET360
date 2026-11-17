-- YG-190, YG-196: varsayım/koşullu kalem ve alternatifler ana toplamdan ayrı; opsiyon işareti teklife geçer.
ALTER TABLE kapsam_satiri ADD COLUMN satir_turu text NOT NULL DEFAULT 'Ana Kapsam' CHECK (satir_turu IN ('Ana Kapsam', 'Opsiyon', 'Koşullu', 'Alternatif'));
