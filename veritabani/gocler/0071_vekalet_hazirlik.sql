-- YG-1058: Hukuk ve Uyum Direktörü vekili (Hukuk ve Uyum Uzmanı) yalnız hazırlık yetkisi taşır; hukuki onaylar GMY'ye gider (LST_KRITIK_POZISYON_VEKILI).
ALTER TABLE vekalet ADD COLUMN yalniz_hazirlik boolean NOT NULL DEFAULT false;
