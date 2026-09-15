@echo off
cd /d "%~dp0"
:loop
echo [%date% %time%] starting memebot >> data\runner.log
node src\main.js
echo [%date% %time%] memebot exited with code %errorlevel%, restarting in 5s >> data\runner.log
timeout /t 5 /nobreak >nul
goto loop
