#!/usr/bin/env pwsh
# 娴嬭瘯 PE 浜岃繘鍒?patch 瀹屾暣娴佺▼

$ErrorActionPreference = "Stop"

$exePath = "C:\nvm4w\nodejs\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
$backupPath = "$exePath.zh-cn-backup"
$testJs = "C:\temp\test-pe-patch.js"

Write-Host "=== 娴嬭瘯 PE 浜岃繘鍒?Patch 娴佺▼ ===" -ForegroundColor Blue
Write-Host ""

# 1. 鎭㈠鍘熷鏂囦欢
if (Test-Path $backupPath) {
    Write-Host "鎭㈠鍘熷鏂囦欢..." -ForegroundColor Yellow
    Copy-Item $backupPath $exePath -Force
    Remove-Item $backupPath -Force
    Write-Host "鉁?宸叉仮澶嶅師濮嬫枃浠? -ForegroundColor Green
}

# 2. 鎻愬彇 JavaScript
Write-Host ""
Write-Host "鎻愬彇 JavaScript..." -ForegroundColor Yellow
$extractResult = node plugin/bun-binary-io.js extract $exePath $testJs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "鉁?鎻愬彇澶辫触: $extractResult" -ForegroundColor Red
    exit 1
}
Write-Host "鉁?鎻愬彇鎴愬姛" -ForegroundColor Green

# 3. Patch JavaScript
Write-Host ""
Write-Host "Patch JavaScript..." -ForegroundColor Yellow
$patchCount = node plugin/patch-cli.js $testJs plugin/cli-translations.json 2>&1
if ($LASTEXITCODE -ne 0 -or [int]$patchCount -eq 0) {
    Write-Host "鉁?Patch 澶辫触鎴栨棤鏀瑰姩: $patchCount" -ForegroundColor Red
    exit 1
}
Write-Host "鉁?Patch 鎴愬姛锛?patchCount 澶勶級" -ForegroundColor Green

# 4. 閲嶆墦鍖?Write-Host ""
Write-Host "閲嶆墦鍖?PE 浜岃繘鍒?.." -ForegroundColor Yellow
$repackResult = node plugin/bun-binary-io.js repack $exePath $testJs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "鉁?閲嶆墦鍖呭け璐? $repackResult" -ForegroundColor Red
    exit 1
}
Write-Host "鉁?閲嶆墦鍖呮垚鍔? -ForegroundColor Green

# 5. 楠岃瘉
Write-Host ""
Write-Host "楠岃瘉 patch 缁撴灉..." -ForegroundColor Yellow
$verifyJs = "C:\temp\verify-pe-patch.js"
$verifyResult = node plugin/bun-binary-io.js extract $exePath $verifyJs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "鉁?楠岃瘉澶辫触锛堟棤娉曟彁鍙栵級: $verifyResult" -ForegroundColor Red
    exit 1
}

$englishCount = (Select-String -Path $verifyJs -Pattern "Quick safety check" -AllMatches).Matches.Count
if ($englishCount -gt 0) {
    Write-Host "鉁?楠岃瘉澶辫触锛堜粛鏈?$englishCount 澶勮嫳鏂囨畫鐣欙級" -ForegroundColor Red
    exit 1
}

Write-Host "鉁?楠岃瘉鎴愬姛锛堟棤鑻辨枃娈嬬暀锛? -ForegroundColor Green

# 娓呯悊
Remove-Item $testJs, $verifyJs -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== 娴嬭瘯瀹屾垚锛?==" -ForegroundColor Blue
