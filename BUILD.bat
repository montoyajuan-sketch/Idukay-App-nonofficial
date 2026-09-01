@echo off
setlocal

echo ============================================
echo   Idukay App - Build completo
echo ============================================
echo.

REM Verifica que Node.js este instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] No se encontro Node.js instalado.
    echo Descargalo desde https://nodejs.org/ e intenta de nuevo.
    pause
    exit /b 1
)

echo [1/2] Instalando dependencias (npm install)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Fallo la instalacion de dependencias.
    pause
    exit /b 1
)

echo.
echo [2/2] Generando ejecutable (npm run build)...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Fallo la generacion del ejecutable.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Build completado. Revisa la carpeta "dist"
echo ============================================
pause
