import os

from dotenv import load_dotenv

load_dotenv()

DISCORD_WEBHOOK_URL   = os.getenv("DISCORD_WEBHOOK_URL", "")
SIZE_LIMIT_MB         = float(os.getenv("SIZE_LIMIT_MB", "10"))
GDRIVE_CREDS_FILE     = os.getenv("GDRIVE_CREDENTIALS_FILE", "credentials.json")
GDRIVE_TOKEN_FILE     = "token.pickle"
SCOPES                = ["https://www.googleapis.com/auth/drive.file"]
# 보수적 압축률 가정: zip이 원본의 85% 수준 → 이 값이 SIZE_LIMIT_MB 이하일 때만 zip 시도
ZIP_COMPRESSION_RATIO = 0.85
