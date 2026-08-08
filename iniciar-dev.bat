@echo off
title HappySite - Modo Desenvolvimento
color 0A
echo ====================================
echo   HappySite - Iniciando (DEV)
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

echo.
echo Iniciando servidor backend na porta 3001...
start "HappySite - Backend" cmd /k "cd server && node server.js"

timeout /t 3 /nobreak >nul

echo Iniciando cliente (Vite) na porta 5173...
start "HappySite - Frontend" cmd /k "cd client && npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo ====================================
echo   HappySite rodando!
echo   Acesse: http://localhost:5173
echo   Login padrao: admin / admin
echo ====================================
start http://localhost:5173

pause
