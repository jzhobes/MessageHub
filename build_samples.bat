@echo off
setlocal

:: Resolve Project Root (Current Directory)
set "PROJECT_ROOT=%~dp0"
:: Remove trailing backslash
set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

set "SAMPLES_DIR=%PROJECT_ROOT%\samples"
set "DATA_SAMPLES_DIR=%PROJECT_ROOT%\data_samples"


:: Check for venv, run setup if missing
if not exist "%PROJECT_ROOT%\venv" (
    echo ⚠️  Virtual environment not found. Running setup...
    call "%PROJECT_ROOT%\setup.bat"
)

echo ==^> Building sample workspace in %DATA_SAMPLES_DIR%...

:: Clean and recreate samples workspace
if exist "%DATA_SAMPLES_DIR%" (
    echo   Cleaning old data...
    rmdir /s /q "%DATA_SAMPLES_DIR%"
)
if not exist "%DATA_SAMPLES_DIR%" mkdir "%DATA_SAMPLES_DIR%"

:: Copy samples into the workspace
echo   Copying sample archives...
copy /Y "%SAMPLES_DIR%\facebook_sample.zip" "%DATA_SAMPLES_DIR%\" >nul
copy /Y "%SAMPLES_DIR%\instagram_sample.zip" "%DATA_SAMPLES_DIR%\" >nul
copy /Y "%SAMPLES_DIR%\google_chat_sample.zip" "%DATA_SAMPLES_DIR%\" >nul
copy /Y "%SAMPLES_DIR%\google_voice_sample.zip" "%DATA_SAMPLES_DIR%\" >nul
copy /Y "%SAMPLES_DIR%\google_mail_sample.zip" "%DATA_SAMPLES_DIR%\" >nul

:: Run ingestion
echo ==^> Running python ingestion...
set "WORKSPACE_PATH=%DATA_SAMPLES_DIR%"
:: Use python from venv
"%PROJECT_ROOT%\venv\Scripts\python.exe" "%PROJECT_ROOT%\scripts\ingest.py" --source "%DATA_SAMPLES_DIR%" --delete-archives

echo.
echo ✅ Sample workspace ready at %DATA_SAMPLES_DIR%
echo You can now test search and chat features using this data.

endlocal
