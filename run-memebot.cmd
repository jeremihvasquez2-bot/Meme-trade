@echo off
REM memebot runner. Restarts the bot if it crashes, backing off so a broken
REM build does not spin the CPU. Close this window to stop it.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set WAIT=2
:loop
echo.
echo [%date% %time%] starting memebot...
node src\main.js
set CODE=!errorlevel!
if !CODE! EQU 0 (
  echo [%date% %time%] memebot exited cleanly.
  goto :eof
)
echo [%date% %time%] memebot exited with code !CODE!. Restarting in !WAIT!s...
timeout /t !WAIT! /nobreak >nul
set /a WAIT=!WAIT!*2
if !WAIT! GTR 60 set WAIT=60
goto loop
