@echo off
cd /d %~dp0

if not exist "node_modules" call setup.cmd
node index.js
pause