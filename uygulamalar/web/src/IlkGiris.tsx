import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { istek, type Ben } from './api';
import { KodKutulari } from './Giris';

type Dil = 'tr' | 'en';

// Metinler onaylı G-2 ekranından ve KVKK-10'dan alınmıştır.
const T = {
  tr: {
    hos: 'Hoş Geldiniz', hosLgm: (a: string) => `${a}, LİMİT GLOBAL MARINE personel hesabınız oluşturulmuştur.`, hosDis: (a: string) => `${a}, YATONET 360 hesabınız oluşturulmuştur.`,
    hosNot: 'Hesabınızı birkaç adımda kullanıma hazırlayınız. Bu bağlantı 7 gün geçerlidir.', dilB: 'Tercih Dili', dilN: 'Dili daha sonra profilinizden değiştirebilirsiniz.',
    parB: 'Parolanızı Belirleyiniz', parN: 'Parolanız en az 12 karakterden oluşmalıdır. Hatırlaması kolay, tahmin edilmesi zor bir parola için birkaç kelimeyi boşlukla birleştirerek uzun bir ifade oluşturabilirsiniz; harf, rakam ve işaret karıştırmanız zorunlu değildir.',
    par1: 'Adınız, doğum tarihiniz, telefon numaranız veya kurum adınız gibi kolay tahmin edilebilecek bilgileri kullanmayınız.', par2: 'Başka hesaplarınızda kullandığınız bir parolayı kullanmayınız.', par3: 'Güvenliğiniz için, sızdırıldığı bilinen parolalar sistem tarafından kabul edilmemektedir.', par4: 'Güvenliğiniz için parolanızı kimseyle paylaşmamanızı rica ederiz; LİMİT GLOBAL MARINE parolanızı hiçbir zaman sormaz.',
    par: 'Parola', parT: 'Parolayı Tekrar Giriniz', parK: 'En Az 12 Karakter', esit: 'Parolalar eşleşmektedir.', farkli: 'Parolalar eşleşmemektedir.', goster: 'Parolayı Göster', parNot: 'Parolanızı düzenli olarak değiştirmeniz istenmeyecektir.', parD: 'Parolamı Belirle',
    uygB: 'Doğrulama Uygulaması', uygN: 'Telefonunuza bir doğrulama uygulaması (ör. Google Authenticator, Microsoft Authenticator) kurunuz ve aşağıdaki karekodu okutunuz.', uygA: 'Karekodu okutamıyorsanız kurulum anahtarını uygulamaya giriniz:', uygK: 'Uygulamadaki 6 haneli kodu giriniz.', dogrula: 'Doğrula',
    uygLgm: 'Telefonunuzu kaybederseniz Bilgi İşlem Destek Sorumlusu kimliğinizi doğruladıktan sonra yeni kurulum yapılacaktır.', uygDis: 'Telefonunuzu kaybederseniz kurumunuzun yetkilisinin talebiyle yeni kurulum yapılacaktır.', smsL: 'Doğrulama Uygulaması Kullanamıyorum', smsN: 'Giriş kodu kayıtlı cep telefonunuza SMS ile gönderilecektir.', smsG: 'Kod telefonunuza gönderilmiştir.', geri: '← Geri',
    kosB: 'Kullanım Koşulları', kosN: "YATONET 360'ı kullanmadan önce Portal Kullanım Koşulları'nı okuyunuz. Koşullarda erişiminizin amacı, kapsamı, sorumluluklarınız ve paylaşım kuralları yer almaktadır.", kosK: 'Portal Kullanım Koşullarını okudum ve kabul ediyorum.', devam: 'Devam',
    ayB: 'Aydınlatma', tam: 'Tam Metni Oku', kapa: 'Tam Metni Kapat', bilgi: 'Bilgilendim',
    izB: 'İsteğe Bağlı İzinler', izN: 'Bu izinler isteğe bağlıdır; vermeseniz de YATONET 360 kullanımınız etkilenmez.', soru: 'Bakım ve sezon hatırlatmaları almak ister misiniz?', tum: 'Tümünü Onayla', gec: 'Şimdilik Geç',
    am1: "Aydınlatma Metni'nde açıklanan şekilde kişisel verilerimin bakım ve sezon hatırlatmaları amacıyla işlenmesine açık rıza veriyorum.", am2: "Aydınlatma Metni'nde açıklanan şekilde kişisel verilerimin hizmet ve kampanya tanıtımları amacıyla işlenmesine açık rıza veriyorum.", ka: 'Bu amaçlarla tarafıma ticari elektronik ileti gönderilmesine onay veriyorum:',
    k1: 'SMS', k2: 'E-posta', k3: 'Telefon', k4: 'WhatsApp', oz1: 'Doğum günüm paylaşılsın', oz2: 'Evlilik yıl dönümüm paylaşılsın', oz3: 'İşe giriş yıl dönümüm paylaşılsın (yaş ve doğum yılı gösterilmez)',
    hazB: 'Hesabınız Hazır', hazN: 'Hesabınız kullanıma hazırdır.', ana: 'Ana Ekrana Geç',
    ky01: 'Kimlik, iletişim, yat ve hasar bilgileriniz ile telefon görüşme kayıtlarınız hizmetin yürütülmesi, faturalama ve yasal yükümlülükler için işlenir; hizmetin gerektirdiği ölçüde iş ortaklarımıza ve sigorta şirketine aktarılır. Haklarınız ve ayrıntılar tam metindedir.',
    ky03: 'Çalışan ve yetkili bilgileriniz görevlendirme, yeterlilik doğrulaması, iş güvenliği ve ödeme süreçleri için işlenir. Ayrıntılar tam metindedir.',
    ky04: 'Yetkili ve çalışan bilgileriniz iş ilişkisinin yürütülmesi ve yasal yükümlülükler için işlenir. Ayrıntılar tam metindedir.',
    ky05: 'Çalışan bilgileriniz iş sözleşmesi, bordro, iş güvenliği ve yasal yükümlülükler için işlenir. Ayrıntılar tam metindedir.',
  },
  en: {
    hos: 'Welcome', hosLgm: (a: string) => `${a}, your LİMİT GLOBAL MARINE staff account has been created.`, hosDis: (a: string) => `${a}, your YATONET 360 account has been created.`,
    hosNot: 'Please set up your account in a few steps. This link is valid for 7 days.', dilB: 'Preferred Language', dilN: 'You can change the language later in your profile.',
    parB: 'Set Your Password', parN: 'Your password must be at least 12 characters long. For a password that is easy to remember and hard to guess, you can join several words with spaces; mixing letters, numbers and symbols is not required.',
    par1: 'Do not use easily guessed information such as your name, date of birth, phone number or company name.', par2: 'Do not use a password you use for other accounts.', par3: 'For your security, passwords known to have been leaked are not accepted.', par4: 'For your security, please do not share your password; LİMİT GLOBAL MARINE never asks for your password.',
    par: 'Password', parT: 'Enter Password Again', parK: 'At Least 12 Characters', esit: 'Passwords match.', farkli: 'Passwords do not match.', goster: 'Show Password', parNot: 'You will not be asked to change your password regularly.', parD: 'Set My Password',
    uygB: 'Authenticator App', uygN: 'Install an authenticator app on your phone (e.g. Google Authenticator, Microsoft Authenticator) and scan the code below.', uygA: 'If you cannot scan the code, enter the setup key in the app:', uygK: 'Enter the 6-digit code from the app.', dogrula: 'Verify',
    uygLgm: 'If you lose your phone, a new setup is made after the IT Support Officer verifies your identity.', uygDis: 'If you lose your phone, a new setup is made at the request of your organisation’s authorised person.', smsL: 'I Cannot Use an Authenticator App', smsN: 'The sign-in code will be sent by SMS to your registered mobile phone.', smsG: 'The code has been sent to your phone.', geri: '← Back',
    kosB: 'Terms of Use', kosN: 'Please read the Portal Terms of Use before using YATONET 360. The terms set out the purpose and scope of your access, your responsibilities and the sharing rules.', kosK: 'I have read and accept the Portal Terms of Use.', devam: 'Continue',
    ayB: 'Privacy Notice', tam: 'Read Full Text', kapa: 'Close Full Text', bilgi: 'I Have Been Informed',
    izB: 'Optional Permissions', izN: 'These permissions are optional; your use of YATONET 360 is not affected if you do not give them.', soru: 'Would you like to receive maintenance and seasonal reminders?', tum: 'Approve All', gec: 'Skip for Now',
    am1: 'I give my explicit consent to the processing of my personal data, as described in the Privacy Notice, for maintenance and seasonal reminders.', am2: 'I give my explicit consent to the processing of my personal data, as described in the Privacy Notice, for the promotion of services and campaigns.', ka: 'I approve the sending of commercial electronic messages to me for these purposes:',
    k1: 'SMS', k2: 'Email', k3: 'Telephone', k4: 'WhatsApp', oz1: 'Share my birthday', oz2: 'Share my wedding anniversary', oz3: 'Share my work anniversary (age and year of birth are not shown)',
    hazB: 'Your Account Is Ready', hazN: 'Your account is ready to use.', ana: 'Go to Home Screen',
    ky01: 'Your identity, contact, yacht and damage information and your telephone call recordings are processed for the performance of the service, invoicing and legal obligations, and is transferred to our business partners and the insurance company to the extent required by the service. Your rights and the details are in the full text.',
    ky03: 'Your employee and authorised person information is processed for assignment, qualification verification, occupational safety and payment processes. Details are in the full text.',
    ky04: 'Your authorised person and employee information is processed for the conduct of the business relationship and legal obligations. Details are in the full text.',
    ky05: 'Your employee information is processed for the employment contract, payroll, occupational safety and legal obligations. Details are in the full text.',
  },
};

function Kabuk({ adim, toplam, geri, geriYazi, foto, children }: { adim: number; toplam: number; geri?: () => void; geriYazi?: string; foto?: boolean; children: ReactNode }) {
  return (
    <div className="ilk">
      <div className="ilk-kart">
        <div className="ilk-bas"><img src="/lgm_yatay_tr.png" alt="LİMİT GLOBAL MARINE" />{geri && <button type="button" className="lnk" onClick={geri}>{geriYazi}</button>}</div>
        <div className="ilerleme" aria-hidden="true">{Array.from({ length: toplam }, (_, i) => <i key={i} className={i <= adim ? 'on' : ''} />)}</div>
        {foto && <div className="ilk-foto" />}
        <div className="ilk-ic">{children}</div>
        <div className="ilk-dip"><span className="ayrac" aria-hidden="true" /><img src="/yatonet.png" alt="YATONET 360" /></div>
      </div>
    </div>
  );
}

function TamMetin({ tur, t }: { tur: string; t: (typeof T)['tr'] }) {
  const [acik, setAcik] = useState(false);
  const [m, setM] = useState<string[] | null>(null);
  const ac = async () => {
    if (!m) setM((await istek<{ govde: string[] }>(`/ilk-giris/metin/${tur}`)).govde);
    setAcik(!acik);
  };
  return (
    <>
      <button type="button" className="lnk" onClick={() => void ac()}>{acik ? t.kapa : t.tam}</button>
      {acik && m && <div className="tam-metin" tabIndex={0}>{m.map((p, i) => <p key={i}>{p}</p>)}</div>}
    </>
  );
}

/** G2-1…G2-3: davet bağlantısı, dil, parola, doğrulama uygulaması. */
export function Davet({ belirtec, bitti }: { belirtec: string; bitti: () => void }) {
  const [dil, setDil] = useState<Dil>('tr');
  const t = T[dil];
  const [adim, setAdim] = useState(0);
  const [bilgi, setBilgi] = useState<{ adSoyad: string; lgm: boolean } | null>(null);
  const [hata, setHata] = useState('');
  const [not, setNot] = useState('');
  const [p1, setP1] = useState(''); const [p2, setP2] = useState(''); const [goster, setGoster] = useState(false);
  const [kurulum, setKurulum] = useState<{ qr: string; gizli: string } | null>(null);
  const [kod, setKod] = useState('');
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => { istek<{ adSoyad: string; lgm: boolean }>('/ilk-giris/davet', { belirtec }).then(setBilgi).catch((e) => setHata(e.message)); }, [belirtec]);
  const calistir = async (f: () => Promise<void>) => { setHata(''); setMesgul(true); try { await f(); } catch (e) { setHata((e as Error).message); } finally { setMesgul(false); } };

  if (!bilgi) return <Kabuk adim={0} toplam={3}>{hata ? <div className="hata" role="alert">{hata}</div> : null}</Kabuk>;

  if (adim === 0) return (
    <Kabuk adim={0} toplam={3} foto>
      <h2>{t.hos}</h2>
      <div className="not">{bilgi.lgm ? t.hosLgm(bilgi.adSoyad) : t.hosDis(bilgi.adSoyad)} {t.hosNot}</div>
      <label>{t.dilB}</label>
      <div className="satir2">
        <button type="button" className="secenek orta" onClick={() => { setDil('tr'); setAdim(1); }}><b>Türkçe</b></button>
        <button type="button" className="secenek orta" onClick={() => { setDil('en'); setAdim(1); }}><b>English</b></button>
      </div>
      <div className="not">{t.dilN}</div>
    </Kabuk>
  );

  if (adim === 1) {
    const gonder = (e: FormEvent) => { e.preventDefault(); void calistir(async () => {
      await istek('/ilk-giris/parola', { belirtec, parola: p1, dil });
      history.replaceState(null, '', location.pathname);
      setKurulum(await istek('/kimlik/kurulum')); setAdim(2);
    }); };
    return (
      <Kabuk adim={1} toplam={3} geri={() => setAdim(0)} geriYazi={t.geri}>
        <form onSubmit={gonder}>
          <h2>{t.parB}</h2>
          <div className="not">{t.parN}</div>
          <ul className="not liste-not"><li>{t.par1}</li><li>{t.par2}</li><li>{t.par3}</li><li>{t.par4}</li></ul>
          <label htmlFor="p1">{t.par}</label>
          <input id="p1" type={goster ? 'text' : 'password'} autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
          <div className="not">{[...p1].length >= 12 ? '✔' : '○'} {t.parK}</div>
          <label htmlFor="p2">{t.parT}</label>
          <input id="p2" type={goster ? 'text' : 'password'} autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
          {p2 && <div className="not">{p1 === p2 ? `✔ ${t.esit}` : `✖ ${t.farkli}`}</div>}
          <label className="kutu"><input type="checkbox" checked={goster} onChange={(e) => setGoster(e.target.checked)} /><span>{t.goster}</span></label>
          <div className="not">{t.parNot}</div>
          {hata && <div className="hata" role="alert">{hata}</div>}
          <button className="btn" disabled={mesgul || [...p1].length < 12 || p1 !== p2}>{t.parD}</button>
        </form>
      </Kabuk>
    );
  }

  const dogrula = (e: FormEvent) => { e.preventDefault(); void calistir(async () => { await istek('/kimlik/dogrula', { kod }); bitti(); }); };
  return (
    <Kabuk adim={2} toplam={3}>
      <form onSubmit={dogrula}>
        <h2>{t.uygB}</h2>
        <div className="not">{t.uygN}</div>
        {kurulum && <div className="kurulum"><img src={kurulum.qr} alt={t.uygB} width={200} height={200} /><div className="not orta">{t.uygA}<br /><code>{kurulum.gizli}</code></div></div>}
        <label>{t.uygK}</label>
        <KodKutulari deger={kod} degisti={setKod} />
        {hata && <div className="hata" role="alert">{hata}</div>}
        {not && <div className="not orta">{not}</div>}
        <button className="btn" disabled={mesgul || kod.replace(/\s/g, '').length !== 6}>{t.dogrula}</button>
        {bilgi.lgm ? <div className="not">{t.uygLgm}</div> : (
          <div className="not">
            <button type="button" className="lnk" onClick={() => void calistir(async () => { await istek('/kimlik/sms', {}); setNot(t.smsG); })}>{t.smsL}</button> — {t.smsN}<br />{t.uygDis}
          </div>
        )}
      </form>
    </Kabuk>
  );
}

const AMAC = ['Bakım ve sezon hatırlatmaları', 'Hizmet ve kampanya tanıtımları'];
const KANAL = ['SMS', 'E-posta', 'Telefon', 'WhatsApp'];
const OZEL = ['Özel gün – Doğum günü paylaşımı', 'Özel gün – Evlilik yıl dönümü paylaşımı', 'Özel gün – İşe giriş yıl dönümü paylaşımı'];

function kisaMetin(t: (typeof T)['tr'], grup: string) {
  if (grup === 'LGM İç Rolü') return t.ky05;
  if (grup === 'İş Birliği Firması') return t.ky03;
  return grup.startsWith('Bireysel') ? t.ky01 : t.ky04;
}

/** KVKK-10 Bölüm 2: koşullar, aydınlatma, isteğe bağlı izinler. Girişten sonra eksik olan adımlar sırayla açılır. */
export function IlkAdimlar({ ben, bitti }: { ben: Ben; bitti: () => void }) {
  const t = T[ben.dil];
  const toplam = useState(() => ben.eksik.length + 1)[0];
  const [eksik, setEksik] = useState(ben.eksik);
  const [hata, setHata] = useState('');
  const [kabul, setKabul] = useState(false);
  const [secim, setSecim] = useState<Set<string>>(new Set());
  const adim = eksik[0];
  const sira = toplam - eksik.length - 1;
  const gonder = async (yol: string, govde: object = {}) => {
    setHata('');
    try { setEksik((await istek<{ eksik: Ben['eksik'] }>(yol, govde)).eksik); } catch (e) { setHata((e as Error).message); }
  };
  const degistir = (d: string, a: boolean) => setSecim((s) => { const n = new Set(s); if (a) n.add(d); else n.delete(d); return n; });
  const kutu = (d: string, m: string) => <label key={d} className="kutu"><input type="checkbox" checked={secim.has(d)} onChange={(e) => degistir(d, e.target.checked)} /><span>{m}</span></label>;
  const izinGonder = (s: Set<string>) => gonder('/ilk-giris/izinler', ben.rizaBicimi === 'ozel_gun'
    ? { ozelGunler: OZEL.filter((x) => s.has(x)) }
    : { amaclar: AMAC.filter((x) => s.has(x)), kanallar: KANAL.filter((x) => s.has(x)) });

  if (adim === 'kosullar') return (
    <Kabuk adim={sira} toplam={toplam}>
      <h2>{t.kosB}</h2>
      <div className="not">{t.kosN}</div>
      <TamMetin tur="kosullar" t={t} />
      <label className="kutu"><input type="checkbox" checked={kabul} onChange={(e) => setKabul(e.target.checked)} /><span>{t.kosK}</span></label>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <button className="btn" disabled={!kabul} onClick={() => void gonder('/ilk-giris/kosullar')}>{t.devam}</button>
    </Kabuk>
  );
  if (adim === 'aydinlatma') return (
    <Kabuk adim={sira} toplam={toplam}>
      <h2>{t.ayB}</h2>
      <div className="not">{kisaMetin(t, ben.grup)}</div>
      <TamMetin tur="aydinlatma" t={t} />
      {hata && <div className="hata" role="alert">{hata}</div>}
      <button className="btn" onClick={() => void gonder('/ilk-giris/aydinlatma')}>{t.bilgi}</button>
    </Kabuk>
  );
  if (adim === 'izinler') return (
    <Kabuk adim={sira} toplam={toplam}>
      <h2>{t.izB}</h2>
      <div className="not">{t.izN}</div>
      {ben.rizaBicimi === 'ozel_gun' ? (
        <>{kutu(OZEL[0]!, t.oz1)}{kutu(OZEL[1]!, t.oz2)}{kutu(OZEL[2]!, t.oz3)}</>
      ) : (
        <>
          <label>{t.soru}</label>
          {kutu(AMAC[0]!, t.am1)}{kutu(AMAC[1]!, t.am2)}
          <label>{t.ka}</label>
          <div className="kanallar">{kutu('SMS', t.k1)}{kutu('E-posta', t.k2)}{kutu('Telefon', t.k3)}{kutu('WhatsApp', t.k4)}</div>
          <button type="button" className="btn2 ust-bosluk" onClick={() => void izinGonder(new Set([...AMAC, ...KANAL]))}>{t.tum}</button>
        </>
      )}
      {hata && <div className="hata" role="alert">{hata}</div>}
      <button className="btn" onClick={() => void izinGonder(secim)}>{t.devam}</button>
      {ben.rizaBicimi !== 'ozel_gun' && <div className="orta"><button type="button" className="lnk" onClick={() => void izinGonder(new Set())}>{t.gec}</button></div>}
    </Kabuk>
  );
  return (
    <Kabuk adim={toplam - 1} toplam={toplam}>
      <h2>{t.hazB}</h2>
      <div className="basari">✔ {t.hazN}</div>
      <button className="btn" onClick={bitti}>{t.ana}</button>
    </Kabuk>
  );
}
