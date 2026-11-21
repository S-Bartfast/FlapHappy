@echo off
cd /d "%~dp0"
if not exist node_modules (
  call npm install
  if errorlevel 1 goto fail
)
call npm run dist:portable
if errorlevel 1 goto fail
echo.
echo Done. Your portable program is in the "release" folder: FlapHappy-1.0.0-portable.exe
start "" "%~dp0release"
pause
exit /b 0
:fail
echo.
echo Something went wrong. Is Node.js installed? See README.md
pause
