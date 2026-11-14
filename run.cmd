@echo off
rem Windows shortcut: runs run.sh with Git Bash. Usage from PowerShell: .\run.cmd [page]
"%ProgramFiles%\Git\bin\bash.exe" "%~dp0run.sh" %*
