"""
server.py — Raízes Dashboard Update API
Exposes a single endpoint: POST /api/update
  - Downloads the Google Sheets workbook via service account
  - Runs the extraction pipeline
  - Returns the DATA JSON for the dashboard to consume in-browser

Environment variables required:
  GOOGLE_SERVICE_ACCOUNT_JSON  — contents of the service account JSON file (as a string)
  GOOGLE_SHEETS_FILE_ID        — Google Drive file ID of the workbook
  DASHBOARD_PASSWORD           — password to protect the update endpoint
"""

import os
import json
import tempfile
import base64
import logging
from io import BytesIO

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Google auth
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Raízes Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://raizes.1secondtask.com", "http://localhost:5500"],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "raizes2026")
FILE_ID = os.environ.get("GOOGLE_SHEETS_FILE_ID", "1U7-LGnPc9JktExevHyZMTEY8kPcwzI3yf_1hjsRpaTM")

def get_drive_service():
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not sa_json:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON not set")
    sa_info = json.loads(sa_json)
    creds = Credentials.from_service_account_info(
        sa_info,
        scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)

def download_xlsx(file_id: str) -> bytes:
    service = get_drive_service()
    request = service.files().export_media(
        fileId=file_id,
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    buf = BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()

@app.get("/")
def health():
    return {"status": "ok", "service": "Raízes Dashboard API"}

@app.post("/api/verify")
def verify_password(x_password: str = Header(None, alias="X-Password")):
    """Verify dashboard password — used by the login screen."""
    if x_password != DASHBOARD_PASSWORD:
        raise HTTPException(status_code=401, detail="Senha incorreta")
    return {"ok": True}

@app.post("/api/update")
def update_data(x_password: str = Header(None, alias="X-Password")):
    if x_password != DASHBOARD_PASSWORD:
        raise HTTPException(status_code=401, detail="Senha incorreta")

    log.info("Iniciando atualização de dados...")

    try:
        xlsx_bytes = download_xlsx(FILE_ID)
        log.info(f"Planilha baixada: {len(xlsx_bytes):,} bytes")
    except Exception as e:
        log.error(f"Erro ao baixar planilha: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao acessar Google Drive: {e}")

    try:
        # Write to temp file and run extraction
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp.write(xlsx_bytes)
            tmp_path = tmp.name

        data = run_extraction(tmp_path)
        log.info("Extração concluída com sucesso")
        return JSONResponse(content={"ok": True, "data": data})

    except Exception as e:
        log.error(f"Erro na extração: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro na extração: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass

def run_extraction(xlsx_path: str) -> dict:
    """Run the extraction pipeline and return the DATA dict."""
    import io, contextlib
    from pathlib import Path

    extract_py = str(Path(__file__).parent / "extract.py")
    with open(extract_py) as f:
        src = f.read().replace(
            'XLSX_PATH = "/home/claude/raizes_data_fresh.xlsx"',
            f'XLSX_PATH = {xlsx_path!r}'
        )
    # Execute the script — it prints JSON, which we capture
    ns = {}
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec(compile(src, "extract.py", "exec"), ns)
    return json.loads(buf.getvalue())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
