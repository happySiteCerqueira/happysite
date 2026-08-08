@echo off
title HappySite
color 0A
echo ====================================
echo   HappySite - Iniciando
echo ====================================
echo.

cd /d "%~dp0"

if not exist "server\node_modules" (
  echo Instalando dependencias do servidor...
  cd server
  call npm install
  cd ..
)

if not exist "client\node_modules" (
  echo Instalando dependencias do cliente...
  cd client
  call npm install
  cd ..
)

if not exist "client\dist" (
  echo Gerando build de producao do frontend...
  cd client
  call npm run build
  cd ..
)

echo.
echo Iniciando HappySite (servidor + interface web)...
echo Acesse: http://localhost:3001
echo Login padrao: admin / admin
echo.

start http://localhost:3001
cd server
node server.js

pause
