import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * YG-1591 (CEO 27.10): düğme standardı. "Onaya Gönder" yeşildir ve üstünde "Gönderilecek: [Rol]" satırı bulunur
 * (belgelerdeki "uygun görüşle arz" karşılığı). Rol API'deki onay zincirinin ilk makamıdır; tutara veya birime göre değişen zincirde genel ad yazılır.
 */
export function OnayaGonder({ rol, className = 'btn2', children = 'Onaya Gönder', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { rol: string; children?: ReactNode }) {
  return <span className="onaya-gonder"><span className="gonderilecek">Gönderilecek: <b className="koyu">{rol}</b></span><button className={`${className} evet`} {...p}>{children}</button></span>;
}
