# Geliştirme ortamını pencere açmadan başlatır ve giriş ekranını tarayıcıda açar. Çalışanlara dokunmaz.
param([switch]$TarayiciAcma)
$Y = 'C:\YATONET360'
function Acik($p) { Test-NetConnection 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue }
function Gizli($k) {
  $g = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  [void](Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $k; CurrentDirectory = $Y; ProcessStartupInformation = $g })
}
function Basla($komut, $gunluk) { Gizli "cmd.exe /d /s /c `"cd /d $Y && $komut > .araclar\$gunluk 2>&1`"" }
if (-not (Acik 5432)) {
  $B = "$Y\.araclar\node_modules\@embedded-postgres\windows-x64\native\bin"
  Gizli "`"$B\pg_ctl.exe`" -D `"$Y\.araclar\pgdata`" -l `"$Y\.araclar\postgres.log`" start"
}
if (-not (Acik 3001)) { Basla 'npm run api' 'api.log' }
if (-not (Acik 5173)) { Basla 'npm run web' 'web.log' }
for ($i = 0; $i -lt 40; $i++) {
  if ((Acik 5432) -and (Acik 3001) -and (Acik 5173)) {
    if (-not $TarayiciAcma) { Start-Process 'http://127.0.0.1:5173' }
    'Hazır: http://127.0.0.1:5173'; return
  }
  Start-Sleep -Seconds 1
}
throw 'Sunucu başlamadı; .araclar\api.log ve web.log dosyalarına bakınız.'
