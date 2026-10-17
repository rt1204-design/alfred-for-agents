@echo off
title Alfred for Agents
cd /d "%~dp0"

rem Already running? Just open it.
curl -s -o nul http://localhost:3001/api/health && (
  start "" http://localhost:3001
  exit /b 0
)

where npm >nul 2>nul || (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies, this only happens once...
  call npm install || (pause & exit /b 1)
)

echo Starting Alfred for Agents. Keep this window open; close it to stop Alfred.
set OPEN_BROWSER=1
call npm start
pause
