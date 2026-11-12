-- Yayımlanmış metin satırı değiştirilemez; değişiklik yalnız yeni sürüm satırıyla (INSERT) yapılır. Uygulama yalnız durum ve onay alanlarını günceller.
REVOKE UPDATE ON sablon_metni FROM yatonet_uygulama;
GRANT UPDATE (durum, onaylayan_ref, yayim_zamani) ON sablon_metni TO yatonet_uygulama;
