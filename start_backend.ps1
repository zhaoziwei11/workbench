$ErrorActionPreference = 'Stop'

$Pyw   = 'C:\Users\92893\AppData\Local\Programs\Python\Python312\pythonw.exe'
$Wr    = 'C:\Users\92893\WorkBuddy\automation-2026-07-22-13-54-50\withdraw-report'
$Dist  = 'C:\Users\92893\WorkBuddy\2026-07-28-10-25-30\workbench\dist'
$Port  = '8788'
$PidF  = Join-Path $Wr 'compare_backend.pid'
$LogF  = Join-Path $Wr 'compare_backend.log'

Set-Location $Wr

# Clean previous artefacts
Remove-Item $PidF -ErrorAction SilentlyContinue
Remove-Item $LogF  -ErrorAction SilentlyContinue

$ArgList = @(
    'compare_backend.py',
    '--port', $Port,
    '--host', '127.0.0.1',
    '--dist', $Dist
)

$p = Start-Process -FilePath $Pyw `
                   -ArgumentList $ArgList `
                   -RedirectStandardOutput $LogF `
                   -RedirectStandardError $LogF `
                   -WindowStyle Hidden `
                   -PassThru

Set-Content -Path $PidF -Value $p.Id -Encoding ASCII
Write-Host ("launched PID " + $p.Id)
