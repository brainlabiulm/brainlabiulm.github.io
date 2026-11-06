@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CLI=C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"

if not exist "%NODE_EXE%" (
  echo Node.js non e' stato trovato in C:\Program Files\nodejs.
  echo Installa Node.js oppure modifica NODE_EXE in questo file.
  goto :failed
)

if not exist "%NPM_CLI%" (
  echo npm non e' stato trovato accanto a Node.js.
  echo Reinstalla Node.js oppure modifica NPM_CLI in questo file.
  goto :failed
)

if not exist "node_modules\staticrypt\cli\index.js" (
  echo Installazione delle dipendenze...
  "%NODE_EXE%" "%NPM_CLI%" install
  if errorlevel 1 goto :failed
)

echo Avvio del build BrainLab...
"%NODE_EXE%" build.mjs
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
