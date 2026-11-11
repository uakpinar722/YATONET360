-- YG-1365: "İstisna" durumu sistem bulgusu ve veri hatasında aynı genel anlamı taşır.
UPDATE durum_sozlugu SET is_anlami = 'Kayıt gerekçesiyle istisna kabul edildi; kalan risk ve gerekçe kayıtlıdır.' WHERE durum = 'İstisna';
