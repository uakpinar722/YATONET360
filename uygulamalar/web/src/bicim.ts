/** YG-1384, YG-1383: tutar 1.234,56 EUR / TL; tarih gg.aa.yyyy, saat ss:dd (TSİ). Boş değer "---". */
export const eur = (x: string | number | null | undefined) => (x === null || x === undefined || x === '' ? '---' : `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);
export const tl = (x: string | number | null | undefined) => (x === null || x === undefined || x === '' ? '---' : `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`);
export const tarih = (x: string | Date | null | undefined) => (x ? new Date(x).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' }) : '---');
export const tarihSaat = (x: string | Date | null | undefined) => (x ? new Date(x).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '---');
