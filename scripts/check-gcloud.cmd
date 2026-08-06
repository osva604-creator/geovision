@echo off
where gcloud >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Google Cloud CLI ^(gcloud^) no esta instalado o no esta en el PATH.
  echo.
  echo Opciones:
  echo   1. Instalar Google Cloud CLI en Windows y abrir una terminal nueva.
  echo   2. Usar Google Cloud Shell desde https://shell.cloud.google.com/
  echo.
  exit /b 1
)
gcloud %*
