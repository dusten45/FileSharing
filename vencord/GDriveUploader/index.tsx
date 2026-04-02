import { ChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, DraftType, Forms, React, SelectedChannelStore, Toasts, UploadManager } from "@webpack/common";
import { sendMessage } from "@utils/discord";

import { formatSize, uploadToDrive, uploadFolderToDrive, uploadFolderFromFileList } from "./gdrive";
import { getAccessToken, isAuthenticated, revokeTokens, startOAuthFlow } from "./auth";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settings = definePluginSettings({
    sizeLimitMB: {
        type: OptionType.NUMBER,
        description: "이 크기(MB)를 초과하는 파일은 Google Drive에 업로드됩니다",
        default: 10,
    },
    clientId: {
        type: OptionType.STRING,
        description: "Google OAuth 클라이언트 ID (Google Cloud Console에서 발급)",
        default: "",
    },
    clientSecret: {
        type: OptionType.STRING,
        description: "Google OAuth 클라이언트 시크릿 (Google Cloud Console에서 발급)",
        default: "",
    },
});

// ---------------------------------------------------------------------------
// Settings panel component
// ---------------------------------------------------------------------------

function SettingsPanel() {
    const [authed, setAuthed] = React.useState<boolean | null>(null);

    React.useEffect(() => {
        isAuthenticated().then(setAuthed);
    }, []);

    async function handleConnect() {
        const { clientId, clientSecret } = settings.store;
        if (!clientId || !clientSecret) {
            Toasts.show({
                message: "클라이언트 ID와 시크릿을 먼저 입력해주세요.",
                type: Toasts.Type.FAILURE,
            });
            return;
        }
        try {
            await startOAuthFlow(clientId, clientSecret);
            setAuthed(true);
            Toasts.show({ message: "Google 계정이 연결됐습니다.", type: Toasts.Type.SUCCESS });
        } catch (e: any) {
            Toasts.show({ message: `연결 실패: ${e.message}`, type: Toasts.Type.FAILURE });
        }
    }

    async function handleDisconnect() {
        await revokeTokens();
        setAuthed(false);
        Toasts.show({ message: "Google 계정 연결이 해제됐습니다.", type: Toasts.Type.SUCCESS });
    }

    return (
        <Forms.FormSection>
            <Forms.FormTitle>Google 계정 연결 상태</Forms.FormTitle>
            <Forms.FormText>
                {authed === null ? "확인 중..." : authed ? "✅ 연결됨" : "❌ 연결되지 않음"}
            </Forms.FormText>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {!authed && (
                    <Button onClick={handleConnect} size={Button.Sizes.SMALL}>
                        Google 계정 연결
                    </Button>
                )}
                {authed && (
                    <Button onClick={handleDisconnect} color={Button.Colors.RED} size={Button.Sizes.SMALL}>
                        연결 해제
                    </Button>
                )}
            </div>
            <Forms.FormDivider style={{ marginTop: 16, marginBottom: 8 }} />
            <Forms.FormText>
                클라이언트 ID와 시크릿은 위의 설정 항목에서 입력하세요.
                설정 방법은 플러그인 폴더의 README.md를 참고하세요.
            </Forms.FormText>
        </Forms.FormSection>
    );
}

// ---------------------------------------------------------------------------
// UploadManager helper — clear any state Discord may have accumulated so the
// Nitro upsell modal never gets a chance to appear.
// ---------------------------------------------------------------------------

function clearUploadManager(channelId: string) {
    try {
        UploadManager.clearAll(channelId, DraftType.ChannelMessage);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    } catch { /* ignore — API shape may vary across Discord versions */ }
}

// ---------------------------------------------------------------------------
// Upload file type used in Discord's internal upload module
// ---------------------------------------------------------------------------

interface DiscordUploadFile {
    file: File;
    platform?: number;
    isThumbnail?: boolean;
}

// ---------------------------------------------------------------------------
// Chat bar icon component (used by the new chatBarButton API)
// ---------------------------------------------------------------------------

const FolderIcon = ({ className }: { className?: string }) => (
    <svg aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24" className={className}>
        <path fill="currentColor"
            d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" />
    </svg>
);

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin = definePlugin({
    name: "GDriveUploader",
    description: "10MB를 초과하는 파일을 Google Drive에 자동 업로드하고 링크를 채널에 전송합니다",
    authors: [Devs.Ven], // placeholder — replace with your own entry in Devs constant
    settings,

    // -------------------------------------------------------------------------
    // Webpack patch — intercept Discord's uploadFiles at module load.
    // Handles the upload-button / context-menu path (not covered by DOM events).
    // The previous "onFileSizeError" patch has been removed: it relied on a
    // fragile regex that breaks whenever Discord updates its minified JS, and the
    // event-level interception below is a more reliable replacement.
    // -------------------------------------------------------------------------
    patches: [
        {
            find: "uploadFiles:",
            replacement: {
                match: /uploadFiles:(\i)/,
                replace: "uploadFiles:(...args)=>$self.handleUpload(...args,$1)",
            },
        },
    ],

    // -------------------------------------------------------------------------
    // Lifecycle hooks — register/deregister DOM event listeners
    // -------------------------------------------------------------------------

    // Bound copies stored so the same function reference is used in both
    // addEventListener and removeEventListener.
    _boundPaste: null as EventListener | null,
    _boundDrop: null as EventListener | null,
    _boundDragOver: null as EventListener | null,
    _boundChange: null as EventListener | null,

    start() {
        this._boundPaste = (e: Event) => this._handlePaste(e as ClipboardEvent);
        this._boundDrop = (e: Event) => this._handleDrop(e as DragEvent);
        this._boundDragOver = (e: Event) => this._handleDragOver(e as DragEvent);
        this._boundChange = (e: Event) => this._handleFileInputChange(e);

        // capture: true → fires before Discord's own (bubbling) listeners
        document.addEventListener("paste", this._boundPaste, { capture: true });
        document.addEventListener("drop", this._boundDrop, { capture: true });
        document.addEventListener("dragover", this._boundDragOver, { capture: true });
        document.addEventListener("change", this._boundChange, { capture: true });
    },

    stop() {
        if (this._boundPaste) document.removeEventListener("paste", this._boundPaste, { capture: true });
        if (this._boundDrop) document.removeEventListener("drop", this._boundDrop, { capture: true });
        if (this._boundDragOver) document.removeEventListener("dragover", this._boundDragOver, { capture: true });
        if (this._boundChange) document.removeEventListener("change", this._boundChange, { capture: true });
    },

    // -------------------------------------------------------------------------
    // DOM event handlers
    // -------------------------------------------------------------------------

    _handlePaste(e: ClipboardEvent) {
        const files = e.clipboardData?.files;
        if (!files || files.length === 0) return;

        const fileArray = Array.from(files);
        const limitBytes = settings.store.sizeLimitMB * 1024 * 1024;
        if (!fileArray.some(f => f.size > limitBytes)) return; // all small — let Discord handle

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;
        clearUploadManager(channelId);

        const small = fileArray.filter(f => f.size <= limitBytes);
        const large = fileArray.filter(f => f.size > limitBytes);

        if (small.length > 0) {
            UploadManager.addFiles({
                channelId,
                draftType: DraftType.ChannelMessage,
                files: small.map(f => ({ file: f, platform: 1 })),
                showLargeMessageDialog: false,
            });
        }

        for (const file of large) {
            this.processLargeFile(channelId, file);
        }
    },

    _handleDrop(e: DragEvent) {
        const items = e.dataTransfer?.items;
        if (!items || items.length === 0) return;

        // items는 이벤트 핸들러 종료 후 무효화되므로 동기적으로 스냅샷
        type Snapshot =
            | { kind: "file"; file: File }
            | { kind: "folder"; entry: FileSystemDirectoryEntry };

        const snapshot: Snapshot[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind !== "file") continue;
            const fsEntry = item.webkitGetAsEntry();
            if (fsEntry?.isDirectory) {
                snapshot.push({ kind: "folder", entry: fsEntry as FileSystemDirectoryEntry });
            } else {
                const file = item.getAsFile();
                if (file) snapshot.push({ kind: "file", file });
            }
        }
        if (snapshot.length === 0) return;

        const limitBytes = settings.store.sizeLimitMB * 1024 * 1024;
        const hasFolders = snapshot.some(s => s.kind === "folder");
        const hasLargeFiles = snapshot.some(s => s.kind === "file" && s.file.size > limitBytes);
        if (!hasFolders && !hasLargeFiles) return; // 소파일만 — Discord에게 위임

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;
        clearUploadManager(channelId);

        const smallFiles = snapshot
            .filter((s): s is { kind: "file"; file: File } => s.kind === "file" && s.file.size <= limitBytes)
            .map(s => s.file);
        const largeFiles = snapshot
            .filter((s): s is { kind: "file"; file: File } => s.kind === "file" && s.file.size > limitBytes)
            .map(s => s.file);
        const folderEntries = snapshot
            .filter((s): s is { kind: "folder"; entry: FileSystemDirectoryEntry } => s.kind === "folder")
            .map(s => s.entry);

        if (smallFiles.length > 0) {
            UploadManager.addFiles({
                channelId,
                draftType: DraftType.ChannelMessage,
                files: smallFiles.map(f => ({ file: f, platform: 1 })),
                showLargeMessageDialog: false,
            });
        }
        for (const file of largeFiles) this.processLargeFile(channelId, file);
        for (const entry of folderEntries) this.processFolder(channelId, entry);
    },

    _handleDragOver(e: DragEvent) {
        // preventDefault() is required to make the element a valid drop target
        if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
        }
    },

    _handleFileInputChange(e: Event) {
        const target = e.target as HTMLInputElement;
        if (target.type !== "file" || !target.files?.length) return;

        const files = Array.from(target.files);
        const limitBytes = settings.store.sizeLimitMB * 1024 * 1024;
        if (!files.some(f => f.size > limitBytes)) return; // all small — let Discord handle

        // Grab files before clearing the input
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;

        // Clear the input so Discord sees no files when its own handler runs
        target.value = "";

        // Prevent Discord's change handler from firing at all
        e.stopImmediatePropagation();

        clearUploadManager(channelId);

        const small = files.filter(f => f.size <= limitBytes);
        const large = files.filter(f => f.size > limitBytes);

        if (small.length > 0) {
            UploadManager.addFiles({
                channelId,
                draftType: DraftType.ChannelMessage,
                files: small.map(f => ({ file: f, platform: 1 })),
                showLargeMessageDialog: false,
            });
        }

        for (const file of large) {
            this.processLargeFile(channelId, file);
        }
    },

    // -------------------------------------------------------------------------
    // Upload interceptor
    // -------------------------------------------------------------------------

    async handleUpload(
        channelId: string,
        files: DiscordUploadFile[],
        ...rest: any[]
    ) {
        // Last argument injected by patch is the original function
        const originalUpload: Function = rest[rest.length - 1];
        const passThrough = rest.slice(0, -1); // preserve any extra original args

        const limitBytes = settings.store.sizeLimitMB * 1024 * 1024;
        const large = files.filter(f => f.file.size > limitBytes);
        const normal = files.filter(f => f.file.size <= limitBytes);

        // Send small files through Discord as usual
        if (normal.length > 0) {
            originalUpload(channelId, normal, ...passThrough);
        }

        // Handle oversized files
        for (const item of large) {
            await this.processLargeFile(channelId, item.file);
        }
    },

    async handleFileSizeError(...args: any[]) {
        // Fallback: called when onFileSizeError fires (i.e. Patch 2 regex didn't match).
        // Extracts the File object regardless of whether Discord passes it directly
        // or wrapped in an object, then routes it to Google Drive instead of showing
        // the Nitro upsell modal.
        const file: File | null =
            args[0] instanceof File ? args[0] :
            args[0]?.file instanceof File ? args[0].file : null;
        if (!file) return;

        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) return;

        await this.processLargeFile(channelId, file);
    },

    async processFolder(channelId: string, entry: FileSystemDirectoryEntry) {
        const { clientId, clientSecret } = settings.store;
        if (!clientId || !clientSecret) {
            Toasts.show({ message: "GDriveUploader: 클라이언트 ID/시크릿이 설정되지 않았습니다.", type: Toasts.Type.FAILURE });
            return;
        }
        let accessToken: string;
        try {
            accessToken = await getAccessToken(clientId, clientSecret);
        } catch (e: any) {
            Toasts.show({ message: `GDriveUploader: ${e.message}`, type: Toasts.Type.FAILURE });
            return;
        }

        Toasts.show({ message: `폴더 업로드 시작: ${entry.name}`, type: Toasts.Type.MESSAGE, id: "gdrive-folder-upload-start" });

        try {
            const link = await uploadFolderToDrive(entry, accessToken, percent => {
                Toasts.show({
                    message: `폴더 업로드 중... ${percent}%  ${entry.name}`,
                    type: Toasts.Type.MESSAGE,
                    id: "gdrive-folder-upload-progress",
                });
            });
            sendMessage(channelId, {
                content:
                    `📂 **${entry.name}/**\n` +
                    `-# Discord는 폴더 업로드를 지원하지 않아 Google Drive에 업로드됐어요.\n${link}`,
            });
            Toasts.show({ message: `폴더 업로드 완료: ${entry.name}`, type: Toasts.Type.SUCCESS });
        } catch (e: any) {
            Toasts.show({ message: `폴더 업로드 실패: ${e.message}`, type: Toasts.Type.FAILURE });
        }
    },

    async processFolderFromFileList(channelId: string, files: FileList) {
        const { clientId, clientSecret } = settings.store;
        if (!clientId || !clientSecret) {
            Toasts.show({ message: "GDriveUploader: 클라이언트 ID/시크릿이 설정되지 않았습니다.", type: Toasts.Type.FAILURE });
            return;
        }
        let accessToken: string;
        try {
            accessToken = await getAccessToken(clientId, clientSecret);
        } catch (e: any) {
            Toasts.show({ message: `GDriveUploader: ${e.message}`, type: Toasts.Type.FAILURE });
            return;
        }

        const folderName = files[0]?.webkitRelativePath?.split("/")[0] ?? "folder";

        Toasts.show({ message: `폴더 업로드 시작: ${folderName}`, type: Toasts.Type.MESSAGE, id: "gdrive-folder-upload-start" });

        try {
            const link = await uploadFolderFromFileList(files, accessToken, percent => {
                Toasts.show({
                    message: `폴더 업로드 중... ${percent}%  ${folderName}`,
                    type: Toasts.Type.MESSAGE,
                    id: "gdrive-folder-upload-progress",
                });
            });
            sendMessage(channelId, {
                content:
                    `📂 **${folderName}/**\n` +
                    `-# Discord는 폴더 업로드를 지원하지 않아 Google Drive에 업로드됐어요.\n${link}`,
            });
            Toasts.show({ message: `폴더 업로드 완료: ${folderName}`, type: Toasts.Type.SUCCESS });
        } catch (e: any) {
            Toasts.show({ message: `폴더 업로드 실패: ${e.message}`, type: Toasts.Type.FAILURE });
        }
    },

    async processLargeFile(channelId: string, file: File) {
        const { clientId, clientSecret } = settings.store;

        if (!clientId || !clientSecret) {
            Toasts.show({
                message: "GDriveUploader: 클라이언트 ID/시크릿이 설정되지 않았습니다.",
                type: Toasts.Type.FAILURE,
            });
            return;
        }

        let accessToken: string;
        try {
            accessToken = await getAccessToken(clientId, clientSecret);
        } catch (e: any) {
            Toasts.show({ message: `GDriveUploader: ${e.message}`, type: Toasts.Type.FAILURE });
            return;
        }

        Toasts.show({
            message: `업로드 시작: ${file.name}`,
            type: Toasts.Type.MESSAGE,
            id: "gdrive-upload-start",
        });

        try {
            const link = await uploadToDrive(file, accessToken, percent => {
                Toasts.show({
                    message: `업로드 중... ${percent}%  ${file.name}`,
                    type: Toasts.Type.MESSAGE,
                    id: "gdrive-upload-progress",
                });
            });

            sendMessage(channelId, {
                content:
                    `📁 **${file.name}**  \`${formatSize(file.size)}\`\n` +
                    `-# 파일이 너무 커서 Discord 대신 Google Drive에 업로드됐어요.\n${link}`,
            });

            Toasts.show({
                message: `업로드 완료: ${file.name}`,
                type: Toasts.Type.SUCCESS,
            });
        } catch (e: any) {
            Toasts.show({
                message: `업로드 실패: ${e.message}`,
                type: Toasts.Type.FAILURE,
            });
        }
    },

    // -------------------------------------------------------------------------
    // Settings UI
    // -------------------------------------------------------------------------

    settingsAboutComponent: SettingsPanel,

    chatBarButton: {
        icon: FolderIcon,
        render: ({ channelId, isMainChat }: { channelId: string; isMainChat: boolean; }) => {
            if (!isMainChat) return null;
            return (
                <ChatBarButton
                    tooltip="폴더 업로드"
                    onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        (input as any).webkitdirectory = true;
                        input.style.display = "none";
                        document.body.appendChild(input);
                        input.addEventListener("change", () => {
                            const files = input.files;
                            document.body.removeChild(input);
                            if (!files || files.length === 0) return;
                            plugin.processFolderFromFileList(channelId, files);
                        }, { once: true });
                        input.click();
                    }}
                    buttonProps={{ "aria-label": "폴더 업로드" }}
                >
                    <svg aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24">
                        <path fill="currentColor"
                            d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" />
                    </svg>
                </ChatBarButton>
            );
        },
    },
});

export default plugin;
