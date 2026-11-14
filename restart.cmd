@echo off
rem Windows shortcut: runs restart.sh with Git Bash. Usage from PowerShell: .\restart.cmd [page]
"%ProgramFiles%\Git\bin\bash.exe" "%~dp0restart.sh" %*
