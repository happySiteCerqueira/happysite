@echo off
setlocal EnableDelayedExpansion
title HappySite - Preparar Ambiente de Desenvolvimento
color 0B

echo =============================================================
echo   HappySite - Preparar este computador para desenvolvimento
echo =============================================================
echo.
echo Este script vai verificar/instalar:
echo   - Git
echo   - Node.js (LTS)
echo   - Extensao do VS Code usada no projeto (Cline)
echo   - Dependencias do backend e do frontend (npm install)
echo.
echo Ele NAO baixa o codigo do projeto - use esta pasta ja copiada
echo (pendrive/OneDrive) ou clonada do GitHub.
echo.
pause

cd /d "%~dp0"

REM ---------------------------------------------------------------
REM 1) Verifica se o winget esta disponivel (necessario p/ instalar Git/Node)
REM ---------------------------------------------------------------
where winget >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo [AVISO] "winget" nao foi encontrado neste computador.
  echo         Ele normalmente vem com o Windows 10/11 atualizado, via
  echo         a "App Installer" da Microsoft Store.
  echo         Sem o winget, o script NAO conseguira instalar Git/Node
  echo         automaticamente - baixe manualmente:
  echo           Git:  https://git-scm.com/download/win
  echo           Node: https://nodejs.org/  (versao LTS)
  echo.
  set WINGET_OK=0
) else (
  set WINGET_OK=1
)

REM ---------------------------------------------------------------
REM 2) Verifica/instala o Git
REM ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo Verificando o Git...
echo ---------------------------------------------------------------
where git >nul 2>&1
if %errorlevel% equ 0 (
  for /f "delims=" %%v in ('git --version') do echo [OK] %%v ja instalado.
) else (
  echo Git nao encontrado.
  if "%WINGET_OK%"=="1" (
    echo Instalando Git via winget, aguarde...
    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
      echo [ERRO] Nao foi possivel instalar o Git automaticamente.
      echo        Baixe manualmente em: https://git-scm.com/download/win
    ) else (
      echo [OK] Git instalado com sucesso.
      echo [IMPORTANTE] Pode ser necessario FECHAR esta janela e abrir uma
      echo              nova para o comando "git" ser reconhecido.
    )
  ) else (
    echo [PULADO] Instale manualmente: https://git-scm.com/download/win
  )
)

REM ---------------------------------------------------------------
REM 3) Verifica/instala o Node.js
REM ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo Verificando o Node.js...
echo ---------------------------------------------------------------
where node >nul 2>&1
if %errorlevel% equ 0 (
  for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v ja instalado.
) else (
  echo Node.js nao encontrado.
  if "%WINGET_OK%"=="1" (
    echo Instalando Node.js LTS via winget, aguarde...
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
      echo [ERRO] Nao foi possivel instalar o Node.js automaticamente.
      echo        Baixe manualmente em: https://nodejs.org/  (versao LTS)
    ) else (
      echo [OK] Node.js instalado com sucesso.
      echo [IMPORTANTE] Pode ser necessario FECHAR esta janela e abrir uma
      echo              nova para o comando "node"/"npm" ser reconhecido.
    )
  ) else (
    echo [PULADO] Instale manualmente: https://nodejs.org/  (versao LTS)
  )
)

REM ---------------------------------------------------------------
REM 4) Verifica/instala o VS Code (opcional, mas recomendado)
REM ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo Verificando o Visual Studio Code...
echo ---------------------------------------------------------------
where code >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] VS Code ja instalado.
  set CODE_OK=1
) else (
  echo VS Code nao encontrado.
  if "%WINGET_OK%"=="1" (
    echo Instalando VS Code via winget, aguarde...
    winget install --id Microsoft.VisualStudioCode -e --source winget --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
      echo [ERRO] Nao foi possivel instalar o VS Code automaticamente.
      echo        Baixe manualmente em: https://code.visualstudio.com/
      set CODE_OK=0
    ) else (
      echo [OK] VS Code instalado com sucesso.
      echo [IMPORTANTE] Pode ser necessario FECHAR esta janela e abrir uma
      echo              nova para o comando "code" ser reconhecido.
      set CODE_OK=1
    )
  ) else (
    echo [PULADO] Instale manualmente: https://code.visualstudio.com/
    set CODE_OK=0
  )
)

REM ---------------------------------------------------------------
REM 5) Instala a extensao do VS Code usada no projeto (Cline)
REM ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo Instalando extensoes do VS Code usadas no projeto...
echo ---------------------------------------------------------------
where code >nul 2>&1
if %errorlevel% equ 0 (
  call code --install-extension saoudrizwan.claude-dev --force
  echo [OK] Extensao "Cline" instalada/atualizada.
) else (
  echo [PULADO] VS Code ainda nao esta disponivel no PATH desta janela.
  echo          Feche e abra este script novamente depois de instalar o VS Code,
  echo          ou instale a extensao manualmente pela aba de Extensoes:
  echo          procure por "Cline" (saoudrizwan.claude-dev).
)

REM ---------------------------------------------------------------
REM 6) Instala dependencias do projeto (backend + frontend)
REM ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo Instalando dependencias do projeto (isso pode demorar alguns minutos)...
echo ---------------------------------------------------------------
where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERRO] "npm" nao encontrado no PATH desta janela.
  echo        Feche esta janela, abra uma NOVA e rode este script novamente
  echo        (necessario apos instalar o Node.js pela primeira vez).
  goto FIM
)

echo.
echo Instalando dependencias do SERVIDOR (backend)...
cd server
call npm install
cd ..

echo.
echo Instalando dependencias do CLIENTE (frontend)...
cd client
call npm install
cd ..

REM ---------------------------------------------------------------
REM 7) Verifica o arquivo server/.env (conexao com o banco Neon)
REM ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo Verificando configuracao do banco de dados (server/.env)...
echo ---------------------------------------------------------------
if exist "server\.env" (
  echo [OK] Arquivo server\.env encontrado - a conexao com o banco ja esta configurada.
) else (
  echo [ATENCAO] Arquivo server\.env NAO encontrado!
  echo           Sem ele, o sistema nao consegue conectar ao banco de dados.
  echo           Copie o arquivo server\.env do outro computador para esta
  echo           mesma pasta (server\.env), ou crie um novo baseado no
  echo           modelo server\.env.example preenchendo com a DATABASE_URL
  echo           do Neon.
)

:FIM
echo.
echo =============================================================
echo   Preparacao concluida!
echo =============================================================
echo.
echo Proximos passos:
echo   1) Se instalou Git/Node/VS Code agora pela primeira vez, feche
echo      esta janela e abra o projeto novamente (novo terminal).
echo   2) Confirme que o arquivo server\.env existe e esta correto.
echo   3) Para abrir o projeto no VS Code, use:  code .
echo   4) Para rodar o sistema em modo desenvolvimento, de duplo-clique
echo      em "iniciar-dev.bat".
echo.
pause
