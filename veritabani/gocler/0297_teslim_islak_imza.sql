-- YG-1433: ıslak imzalı taranmış Yat Teslim Tutanağı (YATONET 360 onayı verilemediğinde).
ALTER TABLE teslim_kaydi ADD COLUMN islak_imzali_belge_ref uuid REFERENCES belge (kimlik);
