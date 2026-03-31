const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const API_BASE = "https://www.googleapis.com/drive/v3/files";

// Google Drive resumable upload: 256KB 단위여야 하므로 10 * 256KB = 2.5MB
const CHUNK_SIZE = 256 * 1024 * 10;

export type ProgressCallback = (percent: number) => void;

export interface FileEntry {
    file: File;
    relativePath: string; // 루트 폴더 기준 상대경로, e.g. "src/index.ts"
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatSize };

async function collectFilesFromEntry(
    entry: FileSystemEntry,
    pathPrefix: string,
    results: FileEntry[]
): Promise<void> {
    if (entry.isFile) {
        const file = await new Promise<File>((res, rej) =>
            (entry as FileSystemFileEntry).file(res, rej)
        );
        results.push({ file, relativePath: pathPrefix + entry.name });
    } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let batch: FileSystemEntry[];
        do {
            batch = await new Promise<FileSystemEntry[]>((res, rej) =>
                reader.readEntries(res, rej)
            );
            for (const child of batch) {
                await collectFilesFromEntry(child, pathPrefix + entry.name + "/", results);
            }
        } while (batch.length > 0);
    }
}

async function initResumableUpload(file: File, accessToken: string, parentId?: string): Promise<string> {
    const metadata: Record<string, unknown> = { name: file.name };
    if (parentId) metadata.parents = [parentId];
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

async function createDriveFolder(name: string, accessToken: string, parentId?: string): Promise<string> {
    const metadata: Record<string, unknown> = {
        name,
        mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) metadata.parents = [parentId];

    const res = await fetch(`${API_BASE}?fields=id`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
    });
    if (!res.ok) throw new Error(`Drive folder create failed: ${res.status} ${await res.text()}`);
    return (await res.json()).id as string;
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
 * 폴더를 Google Drive에 폴더 구조 그대로 업로드하고 공개 공유 링크를 반환한다.
 * @param rootEntry   드롭된 루트 디렉터리 엔트리
 * @param accessToken Google OAuth2 액세스 토큰
 * @param onProgress  진행률 콜백 (0~100, 파일 완료 단위)
 * @returns           공개 Google Drive 폴더 링크
 */
export async function uploadFolderToDrive(
    rootEntry: FileSystemDirectoryEntry,
    accessToken: string,
    onProgress: ProgressCallback = () => {}
): Promise<string> {
    // 1. 전체 파일 목록 수집
    const results: FileEntry[] = [];
    await collectFilesFromEntry(rootEntry, "", results);
    onProgress(0);

    // 2. 루트 Drive 폴더 생성
    const rootId = await createDriveFolder(rootEntry.name, accessToken);

    // 3. 하위 폴더 경로 추출 및 생성 (부모 먼저)
    const folderIdMap = new Map<string, string>([["", rootId]]);
    const dirPaths = new Set<string>();
    for (const { relativePath } of results) {
        const parts = relativePath.split("/");
        for (let i = 1; i < parts.length; i++) {
            dirPaths.add(parts.slice(0, i).join("/"));
        }
    }
    for (const dirPath of [...dirPaths].sort((a, b) => a.length - b.length)) {
        const segments = dirPath.split("/");
        const parentPath = segments.slice(0, -1).join("/");
        const dirId = await createDriveFolder(segments[segments.length - 1], accessToken, folderIdMap.get(parentPath));
        folderIdMap.set(dirPath, dirId);
    }

    // 4. 파일 업로드 (파일 완료 단위 진행률)
    for (let i = 0; i < results.length; i++) {
        const { file, relativePath } = results[i];
        const lastSlash = relativePath.lastIndexOf("/");
        const dirPath = lastSlash >= 0 ? relativePath.substring(0, lastSlash) : "";
        const uploadUrl = await initResumableUpload(file, accessToken, folderIdMap.get(dirPath));
        await uploadChunks(file, uploadUrl, () => {});
        onProgress(Math.round(((i + 1) / results.length) * 100));
    }

    // 5. 루트 폴더 공개 설정 (하위 항목에 자동 상속)
    await setPublicReadPermission(rootId, accessToken);
    onProgress(100);
    return `https://drive.google.com/drive/folders/${rootId}`;
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
