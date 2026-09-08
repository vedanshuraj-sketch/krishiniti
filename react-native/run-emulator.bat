@echo off
echo ==============================================
echo   KRISHINITI - Starting Android Emulator Dev
echo ==============================================

cd /d "%~dp0"

echo [1/3] Detecting Wi-Fi IP address...
for /f "tokens=2 delims=:" %%a in ('netsh interface ip show addresses "Wi-Fi" ^| findstr /c:"IP Address"') do set WIFI_IP=%%a
if defined WIFI_IP set WIFI_IP=%WIFI_IP: =%

if defined WIFI_IP (
    echo   Found Wi-Fi IP: %WIFI_IP%
    set REACT_NATIVE_PACKAGER_HOSTNAME=%WIFI_IP%
)

echo.
echo [2/3] Bridging ADB port 8085 for Emulator...
adb reverse tcp:8085 tcp:8085 2>nul
adb reverse tcp:8081 tcp:8081 2>nul

echo.
echo [3/3] Launching App on Android Emulator...
call npm run android
