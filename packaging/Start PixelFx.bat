@echo off
setlocal
start "PixelFx Local Server" /min "%~dp0runtime\node.exe" "%~dp0server.cjs"
endlocal
