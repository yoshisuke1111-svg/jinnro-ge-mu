@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install a supported LTS version from nodejs.org.
  pause
  exit /b 1
)
echo Open http://localhost:3000 in your browser after the server starts.
echo Keep this window open while playing. Press Ctrl+C to stop.
node server.js
pause
