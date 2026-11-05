@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 goto missing
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing
node.exe -e "process.exit(Number(process.versions.node.split('.')[0])===24?0:1)"
if errorlevel 1 goto missing
if not exist "node_modules\tsx\package.json" (
 echo Сначала запустите 01_INSTALL.bat.
 pause
 exit /b 1
)
call npm.cmd run maps:fetch
if errorlevel 1 goto failed
call npm.cmd run maps:import -- artifacts\maps\russia-overpass.json
if errorlevel 1 goto failed
echo Карта обновлена. Переоткройте Mini App. SQLite и Tailscale не менялись.
pause
exit /b 0
:missing
echo Требуются Node.js 24 и npm. Затем запустите 01_INSTALL.bat.
pause
exit /b 1
:failed
echo Импорт не завершён. Предыдущий каталог сохранён. Проверьте доступ к Overpass.
pause
exit /b 1
