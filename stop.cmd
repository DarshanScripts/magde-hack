@echo off
rem Windows shortcut: runs stop.sh with Git Bash. Usage from PowerShell: .\stop.cmd [page]
"%ProgramFiles%\Git\bin\bash.exe" "%~dp0stop.sh" %*
