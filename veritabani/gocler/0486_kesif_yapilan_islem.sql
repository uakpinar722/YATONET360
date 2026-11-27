-- YG-056 (V-1114): keşifte fiilen yapılan işlemler; izinli işlemler listesi dışındaki işlem kaydedilemez.
ALTER TABLE kesif ADD COLUMN yapilan_islemler text[] NOT NULL DEFAULT '{}';
