@echo off
setlocal

set "ROOT=%~dp0"
set "LOCAL_IP=localhost"

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$wifi=$false; $fallback=$null; foreach($line in ipconfig){ if($line -match 'adapter (Wi-?Fi|Wireless|WLAN)'){ $wifi=$true; continue }; if($line -match 'adapter '){ $wifi=$false }; if($line -match 'IPv4.*?:\s*([0-9.]+)'){ if(-not $fallback -and $Matches[1] -notlike '169.254.*'){ $fallback=$Matches[1] }; if($wifi){ $Matches[1]; exit } } }; if($fallback){ $fallback } else { 'localhost' }"`) do set "LOCAL_IP=%%I"

echo Starting local Video Talk ^& Chat servers...
echo.
echo API/signaling: http://localhost:3000
echo Frontend:      http://localhost:5173
echo LAN signaling: http://%LOCAL_IP%:3000
echo.
echo Close the opened terminal windows to stop the servers.
echo.

start "Video Talk API Server :3000" cmd /k "cd /d ""%ROOT%artifacts\api-server"" && set PORT=3000 && pnpm run build && pnpm run start"

start "Video Talk Frontend :5173" cmd /k "cd /d ""%ROOT%artifacts\vcall"" && set PORT=5173 && set BASE_PATH=/ && set VITE_SIGNALING_URL=http://%LOCAL_IP%:3000 && pnpm run dev"

start "" "http://localhost:5173"

endlocal
