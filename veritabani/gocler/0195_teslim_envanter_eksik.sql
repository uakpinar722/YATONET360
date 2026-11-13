-- YG-724: teslimde yat kabul tutanağındaki envantere göre eksik (boşsa eksik yok).
ALTER TABLE teslim_kaydi ADD COLUMN envanter_eksik text;
