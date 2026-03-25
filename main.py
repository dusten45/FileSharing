"""
Discord File Uploader
- 설정된 크기 이하 → Discord Webhook으로 직접 파일 업로드
- 설정된 크기 초과 → Google Drive에 업로드 후 뷰어 링크를 Discord에 전송
- Discord 직접 업로드 실패 시에도 자동으로 Google Drive로 fallback
- 폴더 업로드: 원본 크기에 따라 zip 후 Discord 직접 전송 또는 Drive 폴더 업로드
"""

import os
import sys
import threading
import pickle
import tempfile
import zipfile
import shutil
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from pathlib import Path

import requests
from dotenv import load_dotenv

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

load_dotenv()

# ── 설정 ──────────────────────────────────────────────────────────────────────
DISCORD_WEBHOOK_URL   = os.getenv("DISCORD_WEBHOOK_URL", "")
SIZE_LIMIT_MB         = float(os.getenv("SIZE_LIMIT_MB", "10"))
GDRIVE_CREDS_FILE     = os.getenv("GDRIVE_CREDENTIALS_FILE", "credentials.json")
GDRIVE_TOKEN_FILE     = "token.pickle"
SCOPES                = ["https://www.googleapis.com/auth/drive.file"]
# 보수적 압축률 가정: zip이 원본의 85% 수준 → 이 값이 SIZE_LIMIT_MB 이하일 때만 zip 시도
ZIP_COMPRESSION_RATIO = 0.85
# ─────────────────────────────────────────────────────────────────────────────


# ── Google Drive ──────────────────────────────────────────────────────────────

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


# ── Discord ───────────────────────────────────────────────────────────────────

def discord_upload_file(filepath: str) -> bool:
    """파일을 Discord Webhook으로 직접 전송. 성공 여부 반환."""
    filename = Path(filepath).name
    with open(filepath, "rb") as f:
        resp = requests.post(
            DISCORD_WEBHOOK_URL,
            files={"file": (filename, f)},
            timeout=60,
        )
    return resp.status_code in (200, 204)


def discord_send_link(link: str, filename: str, size_mb: float, is_folder: bool = False) -> bool:
    """Google Drive 링크를 Discord에 메시지로 전송."""
    icon = "📁" if is_folder else "📁"
    reason = "폴더라서" if is_folder else "파일이 너무 커서"
    content = (
        f"{icon} **{filename}**  `{size_mb:.1f} MB`\n"
        f"-# {reason} Discord 대신 Google Drive에 업로드됐어요.\n"
        f"{link}"
    )
    resp = requests.post(
        DISCORD_WEBHOOK_URL,
        json={"content": content},
        timeout=10,
    )
    return resp.status_code in (200, 204)


# ── 핵심 로직 ─────────────────────────────────────────────────────────────────

def process_file(filepath: str, log):
    """
    파일 크기를 판단해 Discord 직접 업로드 또는 Drive 업로드 + 링크 전송.
    log: 메시지를 UI에 출력하는 콜백 함수.
    """
    if not DISCORD_WEBHOOK_URL:
        log("❌ .env 파일에 DISCORD_WEBHOOK_URL이 설정되지 않았어요.")
        return

    filename = Path(filepath).name
    size_bytes = os.path.getsize(filepath)
    size_mb    = size_bytes / (1024 * 1024)

    log(f"📄 {filename}  ({size_mb:.2f} MB)")
    log(f"   기준 크기: {SIZE_LIMIT_MB} MB")

    use_drive = size_mb > SIZE_LIMIT_MB

    if not use_drive:
        log(f"⬆️  Discord에 직접 업로드 중...")
        success = discord_upload_file(filepath)
        if success:
            log("✅ Discord 업로드 완료!")
            return
        else:
            log("⚠️  Discord 직접 업로드 실패 → Google Drive로 전환...")
            use_drive = True

    if use_drive:
        try:
            link = upload_to_gdrive(filepath, log)
            log("💬 Discord에 링크 전송 중...")
            discord_send_link(link, filename, size_mb)
            log("✅ 완료! Google Drive 링크가 Discord에 전송됐어요.")
        except FileNotFoundError as e:
            log(f"❌ {e}")
        except Exception as e:
            log(f"❌ 오류 발생: {e}")


def get_folder_raw_size(folder_path: str) -> float:
    """폴더 내 모든 파일의 크기 합산 (MB)."""
    total = 0
    for dirpath, _, filenames in os.walk(folder_path):
        for filename in filenames:
            fp = os.path.join(dirpath, filename)
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return total / (1024 * 1024)


def zip_folder(folder_path: str) -> str:
    """폴더를 임시 zip 파일로 압축하고 zip 경로를 반환."""
    tmp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(tmp_dir, Path(folder_path).name + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _, filenames in os.walk(folder_path):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                arcname = os.path.relpath(filepath, os.path.dirname(folder_path))
                zf.write(filepath, arcname)
    return zip_path


def process_folder(folder_path: str, log):
    """
    폴더 크기를 판단해 zip 후 Discord 직접 업로드 또는 Drive 폴더 업로드 + 링크 전송.
    log: 메시지를 UI에 출력하는 콜백 함수.
    """
    if not DISCORD_WEBHOOK_URL:
        log("❌ .env 파일에 DISCORD_WEBHOOK_URL이 설정되지 않았어요.")
        return

    folder_name = Path(folder_path).name
    raw_mb = get_folder_raw_size(folder_path)

    log(f"📁 {folder_name}/  (원본 {raw_mb:.2f} MB)")
    log(f"   기준 크기: {SIZE_LIMIT_MB} MB")

    # 보수적 압축률(ZIP_COMPRESSION_RATIO)로 추정했을 때도 기준 초과 → zip 생략하고 Drive 폴더 업로드
    estimated_mb = raw_mb * ZIP_COMPRESSION_RATIO
    if estimated_mb > SIZE_LIMIT_MB:
        log(f"   추정 압축 크기 {estimated_mb:.1f} MB > {SIZE_LIMIT_MB} MB → zip 생략, Drive 폴더 업로드")
        try:
            link = upload_folder_to_gdrive(folder_path, log)
            log("💬 Discord에 링크 전송 중...")
            discord_send_link(link, folder_name, raw_mb, is_folder=True)
            log("✅ 완료! Google Drive 폴더 링크가 Discord에 전송됐어요.")
        except FileNotFoundError as e:
            log(f"❌ {e}")
        except Exception as e:
            log(f"❌ 오류 발생: {e}")
        return

    # zip 시도
    log(f"   추정 압축 크기 {estimated_mb:.1f} MB ≤ {SIZE_LIMIT_MB} MB → zip 압축 시도...")
    zip_path = None
    try:
        zip_path = zip_folder(folder_path)
        zip_mb = os.path.getsize(zip_path) / (1024 * 1024)
        log(f"   압축 완료: {zip_mb:.2f} MB")

        if zip_mb <= SIZE_LIMIT_MB:
            log(f"⬆️  Discord에 직접 업로드 중...")
            success = discord_upload_file(zip_path)
            if success:
                log("✅ Discord 업로드 완료!")
                return
            else:
                log("⚠️  Discord 직접 업로드 실패 → Google Drive 폴더로 전환...")

        # zip이 기준 초과이거나 Discord 업로드 실패 → Drive 폴더 구조 업로드
        log(f"   zip {zip_mb:.1f} MB > {SIZE_LIMIT_MB} MB → Drive 폴더 업로드")
        try:
            link = upload_folder_to_gdrive(folder_path, log)
            log("💬 Discord에 링크 전송 중...")
            discord_send_link(link, folder_name, raw_mb, is_folder=True)
            log("✅ 완료! Google Drive 폴더 링크가 Discord에 전송됐어요.")
        except FileNotFoundError as e:
            log(f"❌ {e}")
        except Exception as e:
            log(f"❌ 오류 발생: {e}")

    except Exception as e:
        log(f"❌ 압축 중 오류 발생: {e}")
    finally:
        if zip_path:
            shutil.rmtree(os.path.dirname(zip_path), ignore_errors=True)


# ── GUI ───────────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Discord File Uploader")
        self.geometry("520x440")
        self.resizable(False, False)
        self.configure(bg="#1e1f22")
        self._build_ui()

    def _build_ui(self):
        DARK   = "#1e1f22"
        PANEL  = "#2b2d31"
        ACCENT = "#5865f2"   # Discord Blurple
        TEXT   = "#dbdee1"
        MUTED  = "#949ba4"

        self.configure(bg=DARK)

        # ── Header ──
        header = tk.Frame(self, bg=DARK)
        header.pack(fill="x", padx=24, pady=(20, 0))

        tk.Label(
            header,
            text="Discord File Uploader",
            font=("Segoe UI", 16, "bold"),
            fg=TEXT, bg=DARK,
        ).pack(side="left")

        # ── Info label ──
        info_text = (
            f"≤ {SIZE_LIMIT_MB:.0f} MB  →  Discord 직접 업로드\n"
            f"> {SIZE_LIMIT_MB:.0f} MB  →  Google Drive + 링크 전송\n"
            f"폴더: 크기에 따라 zip 후 Discord 또는 Drive 폴더 업로드"
        )
        info = tk.Label(
            self,
            text=info_text,
            font=("Segoe UI", 10),
            fg=MUTED, bg=DARK,
            justify="left",
        )
        info.pack(anchor="w", padx=26, pady=(6, 12))

        # ── Buttons ──
        btn_frame = tk.Frame(self, bg=PANEL, relief="flat", bd=0)
        btn_frame.pack(fill="x", padx=24)

        self._file_btn = tk.Button(
            btn_frame,
            text="📂  파일 선택",
            font=("Segoe UI", 11, "bold"),
            fg="white",
            bg=ACCENT,
            activebackground="#4752c4",
            activeforeground="white",
            relief="flat",
            bd=0,
            padx=20,
            pady=10,
            cursor="hand2",
            command=self._pick_file,
        )
        self._file_btn.pack(side="left", pady=14, padx=(14, 6))

        self._folder_btn = tk.Button(
            btn_frame,
            text="📁  폴더 선택",
            font=("Segoe UI", 11, "bold"),
            fg="white",
            bg="#3ba55c",   # 초록색으로 구분
            activebackground="#2d8049",
            activeforeground="white",
            relief="flat",
            bd=0,
            padx=20,
            pady=10,
            cursor="hand2",
            command=self._pick_folder,
        )
        self._folder_btn.pack(side="left", pady=14, padx=(0, 14))

        # ── Log area ──
        log_frame = tk.Frame(self, bg=PANEL)
        log_frame.pack(fill="both", expand=True, padx=24, pady=(8, 24))

        scrollbar = tk.Scrollbar(log_frame)
        scrollbar.pack(side="right", fill="y")

        self._log_box = tk.Text(
            log_frame,
            font=("Consolas", 10),
            fg=TEXT,
            bg="#1a1b1e",
            insertbackground=TEXT,
            relief="flat",
            bd=0,
            padx=10,
            pady=8,
            state="disabled",
            wrap="word",
            yscrollcommand=scrollbar.set,
        )
        self._log_box.pack(fill="both", expand=True)
        scrollbar.config(command=self._log_box.yview)

        self._log("준비됨. 파일 또는 폴더를 선택하면 자동으로 처리해요.")

    def _log(self, msg: str):
        self._log_box.config(state="normal")
        self._log_box.insert("end", msg + "\n")
        self._log_box.see("end")
        self._log_box.config(state="disabled")

    def _set_buttons(self, enabled: bool):
        state = "normal" if enabled else "disabled"
        self._file_btn.config(state=state)
        self._folder_btn.config(state=state)
        if not enabled:
            self._file_btn.config(text="처리 중...")
            self._folder_btn.config(text="처리 중...")
        else:
            self._file_btn.config(text="📂  파일 선택")
            self._folder_btn.config(text="📁  폴더 선택")

    def _pick_file(self):
        filepath = filedialog.askopenfilename(title="업로드할 파일 선택")
        if not filepath:
            return
        self._log("\n" + "─" * 48)
        self._set_buttons(False)
        threading.Thread(
            target=self._run_file,
            args=(filepath,),
            daemon=True,
        ).start()

    def _run_file(self, filepath):
        try:
            process_file(filepath, lambda msg: self.after(0, self._log, msg))
        finally:
            self.after(0, self._set_buttons, True)

    def _pick_folder(self):
        folder_path = filedialog.askdirectory(title="업로드할 폴더 선택")
        if not folder_path:
            return
        self._log("\n" + "─" * 48)
        self._set_buttons(False)
        threading.Thread(
            target=self._run_folder,
            args=(folder_path,),
            daemon=True,
        ).start()

    def _run_folder(self, folder_path):
        try:
            process_folder(folder_path, lambda msg: self.after(0, self._log, msg))
        finally:
            self.after(0, self._set_buttons, True)


if __name__ == "__main__":
    app = App()
    app.mainloop()
