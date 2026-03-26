from pathlib import Path

import requests

from config import DISCORD_WEBHOOK_URL


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
