# Helper script to sync frontend and push to GitHub
param(
    [string]$Message = "chore: update app build and sync changes"
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== 1. Syncing latest mobile45 frontend to tauri45 ===" -ForegroundColor Cyan
node scripts/sync-frontend.mjs

Write-Host "`n=== 2. Checking Git status ===" -ForegroundColor Cyan
$status = git status --porcelain

if ($status) {
    Write-Host "`n=== 3. Staging and committing changes ===" -ForegroundColor Cyan
    git add -A
    git commit -m $Message
    
    Write-Host "`n=== 4. Pushing to GitHub (origin main) ===" -ForegroundColor Cyan
    git push origin main
    
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " [SUCCESS] Pushed to GitHub successfully!" -ForegroundColor Green
    Write-Host " Cloud builds are now running automatically online:" -ForegroundColor Green
    Write-Host " https://github.com/mubnaly/tauri45/actions" -ForegroundColor Yellow
    Write-Host "========================================================`n" -ForegroundColor Green
} else {
    Write-Host "`nWorking tree is already clean. Nothing new to commit." -ForegroundColor Yellow
    Write-Host "You can monitor existing builds at:" -ForegroundColor Cyan
    Write-Host "https://github.com/mubnaly/tauri45/actions`n" -ForegroundColor Yellow
}
