@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist ".env" copy /-Y ".env.example" ".env" >nul
start "" /wait notepad.exe "%~dp0.env"
