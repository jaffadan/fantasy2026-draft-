@echo off
echo ========================================================
echo  CBS Sports Fantasy - Interactive Login Setup
echo ========================================================
echo Launching Chromium browser...
echo 1. Log into your CBS Sports account.
echo 2. Navigate to your league page (NEFJ BFFL).
echo 3. Close the browser window when finished.
echo --------------------------------------------------------
python scripts/cbs_sync.py --login
pause
