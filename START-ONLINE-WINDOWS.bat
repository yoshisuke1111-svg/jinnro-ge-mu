@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js LTS is required.
  echo Install it from https://nodejs.org/en/download
  pause
  exit /b 1
)
where ngrok >nul 2>nul
if errorlevel 1 (
  echo [ERROR] ngrok is required for the public test URL.
  echo Install the Windows ngrok agent, then add your authtoken once.
  pause
  exit /b 1
)

echo Starting the game server on http://localhost:3000 ...
start "Werewolf Game Server" cmd /k "cd /d ""%~dp0"" && node server.js"

echo Checking the local server...
powershell -NoProfile -Command "$ok=$false; 1..20 ^| ForEach-Object { try { $r=Invoke-RestMethod -UseBasicParsing http://127.0.0.1:3000/health -TimeoutSec 1; if($r.ok){$ok=$true; break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo [ERROR] The game server did not answer /health.
  echo Check the "Werewolf Game Server" window for the error message.
  pause
  exit /b 1
)

echo Local server is ready.
echo.
echo ngrok will print a public HTTPS URL below.
echo Open that public URL on the host too, create a room, then use the in-game invite URL.
echo A phone on mobile data can join the same room for a real external-network test.
echo Keep BOTH this window and the server window open while using ngrok.
echo Press Ctrl+C here to stop the public tunnel.
echo.
ngrok http 3000
pause
