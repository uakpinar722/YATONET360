# Kod Varsayımları

Katalogda veya kararlarda cevabı olmayan konularda kodda alınan varsayımlar. Modül adımı sonunda CEO'ya toplu sunulur; onaylanan veya değiştirilen satır kataloğa işlenir.

| No | Adım | Konu | Varsayım | Yer | Durum |
|---|---|---|---|---|---|
| V-1 | 1 | Rol Kataloğunu görenler | Sistem Yöneticisi, Bilgi İşlem Müdürü, Bilgi Teknolojileri ve Firma Yönetimi Direktörü | `kurulum.ts` | Sunuldu, itiraz yok |
| V-2 | 1 | İşlem İzini görenler | İç Denetçi, İç Denetim Müdürü, Bilgi İşlem Müdürü; CEO görmez | `kurulum.ts` | Sunuldu, itiraz yok |
| V-3 | 1 | Erişim talebini kim açar | Tüm LGM personeli | `erisim.ts` | Sunulacak |
| V-4 | 1 | Bireysel yat sahibinde kurtarma | SMS kullandığı için hesap kurtarma gerekmez | `hesap_kurtarma.ts` | Sunulacak |
| V-5 | 1 | Hesap kurtarma kapsamı | Yalnız ikinci faktör sıfırlanır, parola değişmez; kullanıcı parolasını Parolamı Unuttum ile yeniler | `hesap_kurtarma.ts` | Sunulacak |
| V-6 | 1 | İç Denetim Müdürü erişim talebi | Risk ve Kalite Direktörü onaylar (idari bağlılık) | `erisim.ts` | Sunulacak |
