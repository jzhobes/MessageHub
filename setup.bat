@echo off
:: Windows Setup Script

echo ==^> Setting up MessageHub environment...

:: 1. Create venv if it doesn't exist
if not exist venv (
    echo Creating virtual environment 'venv'...
    python -m venv venv
) else (
    echo Found existing virtual environment.
)

:: 2. Activate and install requirements
:: This activates it only for this script context
call venv\Scripts\activate

echo Installing dependencies from scripts\requirements.txt...
python -m pip install --upgrade pip
pip install -r scripts\requirements.txt

echo.
echo ✅ Setup Complete!
echo To execute scripts, use: venv\Scripts\python scripts\ingest.py
echo Or activate your shell with: venv\Scripts\activate
