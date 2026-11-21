@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing components, this takes a few minutes...
  call npm install
  if errorlevel 1 goto fail
)
call npm run build
if errorlevel 1 goto fail
call npx electron . %*
exit /b 0
:fail
echo.
echo Something went wrong. Is Node.js installed? See README.md
pause
