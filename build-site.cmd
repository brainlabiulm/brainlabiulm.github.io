@echo off
setlocal
cd /d "%~dp0"

set "NPM_CMD=npm.cmd"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\npm.cmd" (
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
  ) else (
    echo Node.js e npm non sono stati trovati.
    echo Installa Node.js e poi riapri questo file.
    goto :failed
  )
)

if not exist "node_modules\staticrypt\cli\index.js" (
  echo Installazione delle dipendenze...
  call "%NPM_CMD%" install
  if errorlevel 1 goto :failed
)

echo Avvio del build BrainLab...
call "%NPM_CMD%" run build
if errorlevel 1 goto :failed

echo.
echo Build completato. Le pagine cifrate sono nella cartella docs.
echo Per pubblicarle, carica la cartella docs nel repository GitHub.
echo.
pause
exit /b 0

:failed
echo.
echo Build non completato. Leggi il messaggio di errore qui sopra.
echo.
pause
exit /b 1
