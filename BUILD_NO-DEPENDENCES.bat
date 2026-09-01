@echo off
setlocal

echo ============================================
echo   Idukay App - Build (sin instalar dependencias)
echo ============================================
echo.

REM Verifica que node_modules ya exista
if not exist "node_modules" (
    echo [ERROR] No se encontro la carpeta "node_modules".
    echo Ejecuta primero BUILD.bat, o corre "npm install" manualmente.
    pause
    exit /b 1
)

echo Generando ejecutable (npm run build)...
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
