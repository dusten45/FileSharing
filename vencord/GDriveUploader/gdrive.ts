const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const API_BASE = "https://www.googleapis.com/drive/v3/files";

// Google Drive resumable upload: 256KB 단위여야 하므로 10 * 256KB = 2.5MB
const CHUNK_SIZE = 256 * 1024 * 10;

export type ProgressCallback = (percent: number) => void;

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatSize };

async function initResumableUpload(file: File, accessToken: string): Promise<string> {
    const metadata = { name: file.name };
    const res = await fetch(`${UPLOAD_BASE}?uploadType=resumable`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": file.type || "application/octet-stream",
            "X-Upload-Content-Length": String(file.size),
        },
        body: JSON.stringify(metadata),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Drive upload init failed: ${res.status} ${body}`);
    }

    const location = res.headers.get("Location");
    if (!location) throw new Error("Drive upload init: 'Location' 헤더가 없습니다.");
    return location;
}

async function uploadChunks(
    file: File,
    uploadUrl: string,
    onProgress: ProgressCallback
): Promise<string> {
    let offset = 0;
    let fileId = "";

    while (offset < file.size) {
        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = file.slice(offset, end);

        const res = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
                "Content-Type": file.type || "application/octet-stream",
            },
            body: chunk,
        });

        // 308 Resume Incomplete: 청크 완료, 다음 청크 계속
        // 200/201: 전체 업로드 완료
        if (res.status === 308) {
            const range = res.headers.get("Range");
            // Range: bytes=0-{n}  → 다음 offset은 n+1
            offset = range ? parseInt(range.split("-")[1], 10) + 1 : end;
        } else if (res.status === 200 || res.status === 201) {
            const json = await res.json();
            fileId = json.id;
            offset = end;
        } else {
            const body = await res.text();
            throw new Error(`Drive chunk upload failed: ${res.status} ${body}`);
        }

        onProgress(Math.round((Math.min(offset, file.size) / file.size) * 100));
    }

    if (!fileId) throw new Error("업로드가 완료됐지만 파일 ID를 받지 못했습니다.");
    return fileId;
}

async function setPublicReadPermission(fileId: string, accessToken: string): Promise<void> {
    const res = await fetch(`${API_BASE}/${fileId}/permissions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Drive permission set failed: ${res.status} ${body}`);
    }
}

/**
 * 파일을 Google Drive에 업로드하고 공개 공유 링크를 반환한다.
 * @param file       업로드할 파일
 * @param accessToken  Google OAuth2 액세스 토큰
 * @param onProgress  진행률 콜백 (0~100)
 * @returns          공개 Google Drive 링크
 */
export async function uploadToDrive(
    file: File,
    accessToken: string,
    onProgress: ProgressCallback = () => { }
): Promise<string> {
    onProgress(0);

    const uploadUrl = await initResumableUpload(file, accessToken);
    const fileId = await uploadChunks(file, uploadUrl, onProgress);
    await setPublicReadPermission(fileId, accessToken);

    onProgress(100);
    return `https://drive.google.com/file/d/${fileId}/view`;
}
