# Config
$projectPath = "C:\Users\Administrator\container-tracking\spi-arabscale-sync"
$serviceName = "ArabScaleSync"
$localPort    = 3002

# Helper function to run commands and print output
function Run-Command($name, $scriptBlock) {
    Write-Host "=== $name ==="
    try {
        & $scriptBlock 2>&1 | ForEach-Object { Write-Host $_ }
        Write-Host "$name completed successfully.`n"
    } catch {
        Write-Host "$name failed: $_`n"
    }
}

# Change to project directory
Set-Location $projectPath

# Pull latest code from git
# Fetch latest commits
Run-Command "Git Fetch" { git fetch }

# Check if local is behind remote
$local = git rev-parse "@"
$remote = git rev-parse "@{u}"

if($local -eq $remote) {
    Write-Host "No changes detected. Skipping deployment."
    exit 0
} else {
    Write-Host "Changes detected. Proceeding with deployment..."
    Run-Command "Git Pull" { git reset --hard; git pull }
}

# Stop the service
Run-Command "Stop Service" { Stop-Service -Name $serviceName -Force }

# Build the project
Run-Command "Build" { npm install; npm run build; }

# Start the service
Run-Command "Start Service" { Start-Service -Name $serviceName }

Write-Host "Deployment completed."


# ---- Website checks ----

Write-Host "Checking connection on localhost:$localPort..."
$localCheck   = Test-NetConnection -ComputerName "localhost" -Port $localPort -WarningAction SilentlyContinue

if ($localCheck.TcpTestSucceeded) {
    Write-Host "Website is running locally on port $localPort"
} else {
    Write-Host "Website check failed!"
    Write-Host " - localhost:3000 is not reachable"
    exit 1
}
