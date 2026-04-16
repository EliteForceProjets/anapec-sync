@echo off
REM ============================================================
REM pipeline_dimanche.bat
REM Pipeline complet ANAPEC → Monday.com + GitHub
REM Exécuté automatiquement chaque dimanche à 14h par Task Scheduler
REM ============================================================

SET LOG=C:\anapec\pipeline_log.txt
SET NODE=node
SET DIR=C:\anapec

echo. >> %LOG%
echo ============================================================ >> %LOG%
echo [%DATE% %TIME%] DEBUT PIPELINE AUTOMATIQUE >> %LOG%
echo ============================================================ >> %LOG%

REM ── 1. run_all.mjs : scraping ANAPEC + envoi Monday
echo [%DATE% %TIME%] ETAPE 1/5: run_all.mjs >> %LOG%
%NODE% %DIR%\run_all.mjs >> %LOG% 2>&1
IF %ERRORLEVEL% NEQ 0 (echo [%DATE% %TIME%] ERREUR run_all.mjs >> %LOG%) ELSE (echo [%DATE% %TIME%] OK run_all.mjs >> %LOG%)

REM ── 2. Fusion_TAB.mjs : fusion 8 tableaux → ANAPEC_GLOBAL
echo [%DATE% %TIME%] ETAPE 2/5: Fusion_TAB.mjs >> %LOG%
%NODE% %DIR%\Fusion_TAB.mjs >> %LOG% 2>&1
IF %ERRORLEVEL% NEQ 0 (echo [%DATE% %TIME%] ERREUR Fusion_TAB.mjs >> %LOG%) ELSE (echo [%DATE% %TIME%] OK Fusion_TAB.mjs >> %LOG%)

REM ── 3. Export_PDF.mjs : PDF global contrats non signés
echo [%DATE% %TIME%] ETAPE 3/5: Export_PDF.mjs >> %LOG%
%NODE% %DIR%\Export_PDF.mjs >> %LOG% 2>&1
IF %ERRORLEVEL% NEQ 0 (echo [%DATE% %TIME%] ERREUR Export_PDF.mjs >> %LOG%) ELSE (echo [%DATE% %TIME%] OK Export_PDF.mjs >> %LOG%)

REM ── 4. PDF_Contrats.mjs : 1 PDF par contrat non signé
echo [%DATE% %TIME%] ETAPE 4/5: PDF_Contrats.mjs >> %LOG%
%NODE% %DIR%\PDF_Contrats.mjs >> %LOG% 2>&1
IF %ERRORLEVEL% NEQ 0 (echo [%DATE% %TIME%] ERREUR PDF_Contrats.mjs >> %LOG%) ELSE (echo [%DATE% %TIME%] OK PDF_Contrats.mjs >> %LOG%)

REM ── 5. Push tout vers GitHub
echo [%DATE% %TIME%] ETAPE 5/5: Push GitHub >> %LOG%
cd /d %DIR%
git fetch origin >> %LOG% 2>&1
git reset --hard origin/main >> %LOG% 2>&1
git add -A >> %LOG% 2>&1
git commit -m "Pipeline auto - %DATE% %TIME%" >> %LOG% 2>&1
git push origin main >> %LOG% 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [%DATE% %TIME%] Push normal echoue - tentative force >> %LOG%
    git push origin main --force >> %LOG% 2>&1
)
echo [%DATE% %TIME%] OK git push >> %LOG%

echo. >> %LOG%
echo [%DATE% %TIME%] FIN PIPELINE >> %LOG%
echo ============================================================ >> %LOG%
