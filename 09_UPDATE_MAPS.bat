@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
 echo Установите Node.js 24, затем запустите 01_INSTALL.bat.
 pause
 exit /b 1
)
node.exe "%~dp0scripts\maps-menu.mjs"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
