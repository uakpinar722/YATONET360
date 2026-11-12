-- YG-597: ileri tarihli sürüm kapsam ve geçiş kuralıyla yayımlanır (Ek II: doldurulmuş kayıt geriye dönük yeniden yazılmaz).
ALTER TABLE belge_surum ADD COLUMN yururluk_kapsami text CHECK (yururluk_kapsami IN ('Yürürlükten sonra açılan kayıtlar', 'Açık kayıtlar dahil')), ADD COLUMN gecis_kurali text;
