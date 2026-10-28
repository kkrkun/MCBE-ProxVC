@echo off
setlocal enabledelayedexpansion

for /f "tokens=1,2,3 delims=.v " %%a in ('node -v 2^>nul') do (
    set NODE_MAJOR=%%a
)

if not defined NODE_MAJOR (
    echo Node.js not found. Installing Node.js LTS...
    goto INSTALL_NODE
)

if !NODE_MAJOR! LSS 18 (
    echo Node.js version is lower than 18. Updating...
    goto INSTALL_NODE
)

echo Node.js version 18 or higher is detected.
goto CONTINUE

:INSTALL_NODE
winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"

:CONTINUE
CheckNetIsolation.exe LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"
npm i

pause