/** YG-735: rapor ve özet satırından ilgili dosyaya geri ulaşım; dosya numarası aranır ve açılır. */
export function DosyaBag({ no }: { no: string }) {
  return <button type="button" className="baglanti" onClick={() => window.dispatchEvent(new CustomEvent('dosya-git', { detail: no }))}>{no}</button>;
}
