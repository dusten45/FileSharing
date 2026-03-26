import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from config import DISCORD_WEBHOOK_URL, SIZE_LIMIT_MB, ZIP_COMPRESSION_RATIO
from discord_client import discord_upload_file, discord_send_link
from gdrive import upload_to_gdrive, upload_folder_to_gdrive


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
