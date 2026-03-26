import os
import pickle
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from config import GDRIVE_CREDS_FILE, GDRIVE_TOKEN_FILE, SCOPES


def get_gdrive_service():
    """OAuth2 인증 후 Drive service 반환. 최초 실행 시 브라우저 인증 진행."""
    creds = None

    if os.path.exists(GDRIVE_TOKEN_FILE):
        with open(GDRIVE_TOKEN_FILE, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(GDRIVE_CREDS_FILE):
                raise FileNotFoundError(
                    f"Google OAuth 인증 파일을 찾을 수 없어요: {GDRIVE_CREDS_FILE}\n"
                    "README의 Google Drive API 설정 단계를 따라주세요."
                )
            flow = InstalledAppFlow.from_client_secrets_file(GDRIVE_CREDS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(GDRIVE_TOKEN_FILE, "wb") as f:
            pickle.dump(creds, f)

    return build("drive", "v3", credentials=creds, cache_discovery=False)


def upload_to_gdrive(filepath: str, log) -> str:
    """파일을 Google Drive에 업로드하고 뷰어 공개 링크를 반환."""
    service = get_gdrive_service()
    filename = Path(filepath).name

    log(f"  ☁️  Google Drive 업로드 시작: {filename}")

    media    = MediaFileUpload(filepath, resumable=True)
    metadata = {"name": filename}

    request  = service.files().create(body=metadata, media_body=media, fields="id")

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            log(f"  ⬆️  업로드 중... {pct}%")

    file_id = response.get("id")

    service.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"}
    ).execute()

    link = f"https://drive.google.com/file/d/{file_id}/view"
    log(f"  🔗  링크 생성됨: {link}")
    return link


def upload_folder_to_gdrive(folder_path: str, log) -> str:
    """폴더를 Google Drive에 폴더 구조 그대로 업로드하고 공개 폴더 링크를 반환."""
    service = get_gdrive_service()
    folder_name = Path(folder_path).name

    log(f"  ☁️  Google Drive 폴더 업로드 시작: {folder_name}")

    def create_drive_folder(name: str, parent_id: str | None = None) -> str:
        metadata: dict[str, object] = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if parent_id:
            metadata["parents"] = [parent_id]
        folder = service.files().create(body=metadata, fields="id").execute()
        return folder.get("id")

    def upload_file(filepath: str, parent_id: str):
        filename = Path(filepath).name
        media = MediaFileUpload(filepath, resumable=True)
        metadata = {"name": filename, "parents": [parent_id]}
        request = service.files().create(body=metadata, media_body=media, fields="id")
        response = None
        while response is None:
            _, response = request.next_chunk()

    # Drive에 최상위 폴더 생성
    root_id = create_drive_folder(folder_name)

    # os.walk로 폴더 구조 재현
    drive_id_map = {folder_path: root_id}

    for dirpath, dirnames, filenames in os.walk(folder_path):
        parent_id = drive_id_map[dirpath]

        for dirname in dirnames:
            sub_path = os.path.join(dirpath, dirname)
            sub_id = create_drive_folder(dirname, parent_id)
            drive_id_map[sub_path] = sub_id

        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            log(f"  ⬆️  업로드 중: {Path(filepath).relative_to(folder_path)}")
            upload_file(filepath, parent_id)

    # 폴더 공개 링크
    service.permissions().create(
        fileId=root_id,
        body={"type": "anyone", "role": "reader"}
    ).execute()

    link = f"https://drive.google.com/drive/folders/{root_id}"
    log(f"  🔗  폴더 링크 생성됨: {link}")
    return link
