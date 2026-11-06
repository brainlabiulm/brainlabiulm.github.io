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
echo Pubblicazione dei file generati su GitHub...
for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if not "%CURRENT_BRANCH%"=="main" (
  echo Errore: il branch corrente e' "%CURRENT_BRANCH%". Passa al branch main prima di pubblicare.
  goto :failed
)

git add -- docs .staticrypt.json
if errorlevel 1 goto :failed

git diff --cached --quiet -- docs .staticrypt.json
if not errorlevel 1 goto :published

git commit --only -m "Pubblica sito BrainLab" -- docs .staticrypt.json
if errorlevel 1 goto :failed

git push origin main
if errorlevel 1 goto :failed

:published
echo.
echo Build e pubblicazione completati. Le pagine cifrate sono nella cartella docs.
echo.
pause
exit /b 0

:failed
echo.
echo Build non completato. Leggi il messaggio di errore qui sopra.
echo.
pause
exit /b 1
