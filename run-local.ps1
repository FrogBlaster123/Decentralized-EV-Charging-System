$ErrorActionPreference = "Stop"

Write-Host "Installing Backend Dependencies..."
cd backend
python -m pip install -r requirements.txt

Write-Host "Starting Backend Nodes as background jobs..."
$peers_a = "http://localhost:8002,http://localhost:8003,http://localhost:8004,http://localhost:8005"
$peers_b = "http://localhost:8001,http://localhost:8003,http://localhost:8004,http://localhost:8005"
$peers_c = "http://localhost:8001,http://localhost:8002,http://localhost:8004,http://localhost:8005"
$peers_d = "http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8005"
$peers_e = "http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004"

Start-Job -Name "Node_A" -ScriptBlock { $env:NODE_ID="A"; $env:PEERS=$using:peers_a; cd $using:PWD; uvicorn app.main:app --port 8001 }
Start-Job -Name "Node_B" -ScriptBlock { $env:NODE_ID="B"; $env:PEERS=$using:peers_b; cd $using:PWD; uvicorn app.main:app --port 8002 }
Start-Job -Name "Node_C" -ScriptBlock { $env:NODE_ID="C"; $env:PEERS=$using:peers_c; cd $using:PWD; uvicorn app.main:app --port 8003 }
Start-Job -Name "Node_D" -ScriptBlock { $env:NODE_ID="D"; $env:PEERS=$using:peers_d; cd $using:PWD; uvicorn app.main:app --port 8004 }
Start-Job -Name "Node_E" -ScriptBlock { $env:NODE_ID="E"; $env:PEERS=$using:peers_e; cd $using:PWD; uvicorn app.main:app --port 8005 }

Write-Host "Backend jobs started. Run 'Get-Job' to view them, or 'Stop-Job *' when you finish."
cd ..

Write-Host "Installing Frontend Dependencies..."
cd frontend
npm install

Write-Host "Starting Frontend Server..."
npm run dev
