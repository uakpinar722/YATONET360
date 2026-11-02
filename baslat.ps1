# Geliştirme ortamını başlatır: veritabanı, sunucu, web. Pencereleri oturumdan bağımsız açar; çalışanlara dokunmaz.
$Y = 'C:\YATONET360'
& "$Y\.araclar\pg_baslat.ps1"
function Acik($p) { Test-NetConnection 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue }
function Basla($komut, $gunluk) {
  $k = "cmd.exe /d /s /c `"cd /d $Y && $komut > .araclar\$gunluk 2>&1`""
  [void](Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $k; CurrentDirectory = $Y })
}
if (-not (Acik 3001)) { Basla 'npm run api' 'api.log' }
if (-not (Acik 5173)) { Basla 'npm run web' 'web.log' }
for ($i = 0; $i -lt 30; $i++) { if ((Acik 3001) -and (Acik 5173)) { 'Hazır: http://127.0.0.1:5173'; return }; Start-Sleep -Seconds 1 }
throw 'Sunucu başlamadı; .araclar\api.log ve web.log dosyalarına bakınız.'
