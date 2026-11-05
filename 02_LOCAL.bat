@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
 echo Установите Node.js 24 LTS с официального сайта nodejs.org.
 pause
 exit /b 1
)
node.exe "%~dp0scripts\launcher.mjs" local
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Операция не завершена. Проверьте сообщение выше и 07_DIAGNOSTICS.bat.
pause
exit /b %RESULT%
