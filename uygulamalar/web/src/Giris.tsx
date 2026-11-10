import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { istek, type GirisYaniti } from './api';
import { YatSahibiKayit } from './Portal';
import { KurumTalebiFormu } from './KurumTalebi';

// Metinler onaylı G-1 ekranından (G1_giris_B) alınmıştır.
const T = {
  tr: {
    kim: 'E-Posta veya Cep Telefonu', par: 'Parola', gir: 'Giriş', unut: 'Parolamı Unuttum', yeni: 'Hesap Oluştur', veya: 'veya', destek: '7/24 Destek Hattı: [●]', motto: 'Maviye Güç Verir',
    kodb: 'Doğrulama Kodu', kodApp: 'Doğrulama uygulamanızdaki 6 haneli kodu giriniz.', kodAppSms: 'Doğrulama uygulamanızdaki 6 haneli kodu giriniz. Uygulamayı kullanamıyorsanız SMS ile kod isteyiniz.', kodSms: 'Telefonunuza gönderilen 6 haneli kodu giriniz.',
    unutN: 'Kayıtlı e-postanıza veya cep telefonunuza parola yenileme bağlantısı gönderilecektir.', unutD: 'Bağlantı Gönder', bosTek: 'Lütfen e-posta veya cep telefonunuzu giriniz.',
    kodd: 'Doğrula', sms: 'Kodu SMS ile Gönder', smsTekrar: 'Kodu Yeniden Gönder', smsGitti: 'Kod telefonunuza gönderilmiştir.', epostaGitti: 'SMS gönderilemediği için kod e-posta adresinize gönderilmiştir.', geri: '← Geri', bos: 'Lütfen iki alanı da doldurunuz.',
    kurB: 'Doğrulama Uygulaması Kurulumu', kurN: 'Doğrulama uygulamanızla bu kodu okutunuz, ardından uygulamanın ürettiği 6 haneli kodu giriniz.', kurEl: 'Elle Girilecek Anahtar',
    hb: 'Hesap Oluştur', hn: 'Sizi doğru yere yönlendirelim:', yakinda: 'Bu adım sonraki kod diliminde açılacaktır.',
    s1: 'Yat Sahibiyim', s1a: 'Cep telefonunuzla SMS koduyla hesap açınız; talebinizi veya hasar bildiriminizi iletiniz.',
    s5: 'Yat Sahibi Adına İşlem Yapıyorum', s5a: 'Kaptan, yetkili temsilci veya yat yönetim şirketi olarak hesap açınız; yat sahibinin bilgisi ve yetki belgesi istenir.',
    s2: 'Çözüm Ortağı Olmak İstiyorum', s2a: 'Firmanız için başvuru yapınız; değerlendirme sonucu size bildirilecek, onaylandığında hesabınız açılacaktır.',
    s3: 'Sigorta Şirketi, Acente, Broker, Kurumsal Müşteri, Tesis veya Tedarikçiyim', s3a: 'İletişim bilgilerinizi bırakınız; ekibimiz sizinle iletişime geçecek ve hesabınızı açacaktır.',
    s4: 'LGM Personeliyim', s4a: 'Hesabınız işe girişte açılır; davet e-postanızı kontrol ediniz.',
  },
  en: {
    kim: 'E-mail or Mobile Phone', par: 'Password', gir: 'Sign In', unut: 'Forgot My Password', yeni: 'Create an Account', veya: 'or', destek: '24/7 Support Line: [●]', motto: 'Powering the Blue',
    kodb: 'Verification Code', kodApp: 'Enter the 6-digit code from your authenticator app.', kodAppSms: 'Enter the 6-digit code from your authenticator app. If you cannot use the app, request a code by SMS.', kodSms: 'Enter the 6-digit code sent to your phone.',
    unutN: 'A password reset link will be sent to your registered e-mail or mobile phone.', unutD: 'Send Link', bosTek: 'Please enter your e-mail or mobile phone.',
    kodd: 'Verify', sms: 'Send Code by SMS', smsTekrar: 'Resend Code', smsGitti: 'The code has been sent to your phone.', epostaGitti: 'As SMS could not be sent, the code has been sent to your e-mail address.', geri: '← Back', bos: 'Please fill in both fields.',
    kurB: 'Authenticator App Setup', kurN: 'Scan this code with your authenticator app, then enter the 6-digit code it generates.', kurEl: 'Key for Manual Entry',
    hb: 'Create an Account', hn: 'Let us direct you to the right place:', yakinda: 'This step will open in the next release.',
    s1: 'I Am a Yacht Owner', s1a: 'Open an account with your mobile phone and an SMS code; submit your request or damage notice.',
    s5: 'I Act on Behalf of a Yacht Owner', s5a: 'Open an account as a captain, authorized representative or yacht management company; the owner’s details and authorization document are requested.',
    s2: 'I Want to Become a Solution Partner', s2a: 'Apply for your company; you will be notified of the result and your account will be opened upon approval.',
    s3: 'Insurance Company, Agency, Broker, Corporate Client, Facility or Supplier', s3a: 'Leave your contact details; our team will contact you and open your account.',
    s4: 'I Am LGM Staff', s4a: 'Your account is opened when you join; check your invitation e-mail.',
  },
};
type Dil = keyof typeof T;
type Adim = 'giris' | 'kod' | 'hesap' | 'unuttum' | 'yatsahibi' | 'yatyetkili' | 'kurum';

export function KodKutulari({ deger, degisti }: { deger: string; degisti: (s: string) => void }) {
  const kutu = useRef<(HTMLInputElement | null)[]>([]);
  const yaz = (i: number, v: string) => {
    const r = v.replace(/\D/g, '').slice(-1);
    const a = deger.padEnd(6, ' ').split(''); a[i] = r || ' ';
    degisti(a.join('').trimEnd());
    if (r && i < 5) kutu.current[i + 1]?.focus();
  };
  const tus = (i: number, e: KeyboardEvent) => { if (e.key === 'Backspace' && !deger[i]?.trim() && i > 0) kutu.current[i - 1]?.focus(); };
  const yapistir = (e: ClipboardEvent) => { const s = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (s) { e.preventDefault(); degisti(s); kutu.current[Math.min(s.length, 5)]?.focus(); } };
  return (
    <div className="kod">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input key={i} ref={(x) => { kutu.current[i] = x; }} aria-label={`${i + 1}. hane`} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} autoFocus={i === 0}
          value={deger[i]?.trim() ?? ''} onChange={(e) => yaz(i, e.target.value)} onKeyDown={(e) => tus(i, e)} onPaste={yapistir} />
      ))}
    </div>
  );
}

export function Giris({ girdi }: { girdi: () => void }) {
  const [dil, setDil] = useState<Dil>('tr');
  const t = T[dil];
  const [adim, setAdim] = useState<Adim>('giris');
  const [kimlik, setKimlik] = useState('');
  const [parola, setParola] = useState('');
  const [kod, setKod] = useState('');
  const [hata, setHata] = useState('');
  const [not, setNot] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const [yanit, setYanit] = useState<GirisYaniti | null>(null);
  const [kurulum, setKurulum] = useState<{ qr: string; gizli: string } | null>(null);

  const calistir = async (f: () => Promise<void>) => {
    setHata(''); setNot(''); setMesgul(true);
    try { await f(); } catch (e) { setHata((e as Error).message); } finally { setMesgul(false); }
  };
  const smsGonder = () => calistir(async () => { const r0 = await istek<{ kanal?: string }>('/kimlik/sms', {}); setNot(r0.kanal === 'E-posta' ? t.epostaGitti : t.smsGitti); });
  const gonder = (e: FormEvent) => {
    e.preventDefault();
    if (!kimlik.trim() || !parola) { setHata(t.bos); return; }
    void calistir(async () => {
      const y = await istek<GirisYaniti>('/kimlik/giris', { kimlik, parola });
      setParola(''); setKod(''); setYanit(y); setAdim('kod');
      if (y.kurulumGerekli) setKurulum(await istek('/kimlik/kurulum'));
      if (y.yontem === 'sms') { const r0 = await istek<{ kanal?: string }>('/kimlik/sms', {}); setNot(r0.kanal === 'E-posta' ? t.epostaGitti : t.smsGitti); }
    });
  };
  const dogrula = (e: FormEvent) => {
    e.preventDefault();
    void calistir(async () => { await istek('/kimlik/dogrula', { kod }); girdi(); });
  };
  const geri = () => { setAdim('giris'); setHata(''); setNot(''); setKurulum(null); };
  const kodNotu = yanit?.yontem === 'sms' ? t.kodSms : yanit?.smsAcik ? t.kodAppSms : t.kodApp;

  return (
    <div className="B">
      <div className="foto" />
      <div className="form"><div className="kart">
        <div className="logolar">
          <img className="lgm" src={dil === 'tr' ? '/lgm_yatay_tr.png' : '/lgm_yatay_en.png'} alt={`LİMİT GLOBAL MARINE — ${t.motto}`} />
          <span className="ayrac" aria-hidden="true" />
          <img className="ytn" src="/yatonet.png" alt="YATONET 360" />
        </div>

        {adim === 'giris' && (
          <form onSubmit={gonder}>
            <label htmlFor="k">{t.kim}</label>
            <input id="k" autoComplete="username" placeholder="ornek@firma.com / 05xx xxx xx xx" value={kimlik} onChange={(e) => setKimlik(e.target.value)} />
            <label htmlFor="p">{t.par}</label>
            <input id="p" type="password" autoComplete="current-password" placeholder="••••••••••••" value={parola} onChange={(e) => setParola(e.target.value)} />
            {hata && <div className="hata" role="alert">{hata}</div>}
            <button className="btn" disabled={mesgul}>{t.gir}</button>
            <div className="orta"><button type="button" className="lnk" onClick={() => { setHata(''); setNot(''); setAdim('unuttum'); }}>{t.unut}</button></div>
            <div className="orta"><button type="button" className="lnk" onClick={() => void calistir(async () => { const y = await istek<GirisYaniti>('/kimlik/telefon', { telefon: kimlik }); setYanit(y); setNot((y as { kanal?: string }).kanal === 'E-posta' ? t.epostaGitti : t.smsGitti); setAdim('kod'); })}>{dil === 'tr' ? 'Yat Sahibiyim: Telefonuma Kod Gönder' : 'I am a Yacht Owner: Send a Code to My Phone'}</button></div>
            {not && <div className="not orta">{not}</div>}
            <div className="ayir">{t.veya}</div>
            <button type="button" className="btn2" onClick={() => { setNot(''); setAdim('hesap'); }}>{t.yeni}</button>
          </form>
        )}

        {adim === 'kod' && (
          <form onSubmit={dogrula}>
            {kurulum && (
              <div className="kurulum">
                <label>{t.kurB}</label>
                <div className="not">{t.kurN}</div>
                <img src={kurulum.qr} alt={t.kurB} width={220} height={220} />
                <div className="not"><b>{t.kurEl}:</b> <code>{kurulum.gizli}</code></div>
              </div>
            )}
            <label>{t.kodb}</label>
            {!kurulum && <div className="not">{kodNotu}</div>}
            <KodKutulari deger={kod} degisti={setKod} />
            {hata && <div className="hata" role="alert">{hata}</div>}
            {not && <div className="not orta">{not}</div>}
            <button className="btn" disabled={mesgul || kod.replace(/\s/g, '').length !== 6}>{t.kodd}</button>
            {yanit?.smsAcik && <div className="orta"><button type="button" className="lnk" disabled={mesgul} onClick={() => void smsGonder()}>{yanit.yontem === 'sms' ? t.smsTekrar : t.sms}</button></div>}
            <button type="button" className="lnk" onClick={geri}>{t.geri}</button>
          </form>
        )}

        {adim === 'unuttum' && (
          <form onSubmit={(e) => { e.preventDefault(); if (!kimlik.trim()) { setHata(t.bosTek); return; } void calistir(async () => { setNot((await istek<{ mesaj: string }>('/kimlik/parola-talep', { kimlik })).mesaj); }); }}>
            <h2>{t.unut}</h2>
            <div className="not">{t.unutN}</div>
            <label htmlFor="ku">{t.kim}</label>
            <input id="ku" autoComplete="username" value={kimlik} onChange={(e) => setKimlik(e.target.value)} />
            {hata && <div className="hata" role="alert">{hata}</div>}
            {not && <div className="basari">{not}</div>}
            <button className="btn" disabled={mesgul}>{t.unutD}</button>
            <button type="button" className="lnk" onClick={geri}>{t.geri}</button>
          </form>
        )}

        {adim === 'hesap' && (
          <div>
            <h2>{t.hb}</h2>
            <div className="not">{t.hn}</div>
            {([['s1', 's1a'], ['s5', 's5a'], ['s2', 's2a'], ['s3', 's3a'], ['s4', 's4a']] as const).map(([b, a]) => (
              <button key={b} type="button" className="secenek" onClick={() => { if (b === 's1') setAdim('yatsahibi'); else if (b === 's5') setAdim('yatyetkili'); else if (b === 's3') setAdim('kurum'); else setNot(t.yakinda); }}><b>{t[b]}</b><span>{t[a]}</span></button>
            ))}
            {not && <div className="not orta">{not}</div>}
            <button type="button" className="lnk" onClick={geri}>{t.geri}</button>
          </div>
        )}

        {adim === 'yatsahibi' && <YatSahibiKayit bitti={girdi} geri={() => setAdim('hesap')} />}
        {adim === 'yatyetkili' && <YatSahibiKayit yetkili bitti={girdi} geri={() => setAdim('hesap')} />}
        {adim === 'kurum' && <KurumTalebiFormu dil={dil} geri={() => setAdim('hesap')} />}

        <div className="alt">
          <span className="dil">
            <button type="button" className={dil === 'tr' ? 'secili' : ''} onClick={() => setDil('tr')}>TR</button> | <button type="button" className={dil === 'en' ? 'secili' : ''} onClick={() => setDil('en')}>EN</button>
          </span>
          <span className="destek">{t.destek}</span>
        </div>
      </div></div>
    </div>
  );
}
