@echo off
:: MessageHub Start Script (Windows)

:: 1. Ensure Python environment is ready
if exist setup.bat (
    call setup.bat
) else (
    echo ❌ Error: setup.bat not found in %cd%
    exit /b 1
)

:: 2. Handle Node dependencies in webapp directory
if exist webapp (
    cd webapp
    if not exist node_modules (
        echo ==^> node_modules not found. Installing dependencies...
        call npm install
    )
) else (
    echo ❌ Error: webapp directory not found
    exit /b 1
)

:: 3. Start the application
echo ==^> Starting MessageHub development server...
call npm run dev
