import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, React, Toasts } from "@webpack/common";
import { sendMessage } from "@utils/discord";

import { formatSize, uploadToDrive } from "./gdrive";
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
// Upload file type used in Discord's internal upload module
// ---------------------------------------------------------------------------

interface DiscordUploadFile {
    file: File;
    platform?: number;
    isThumbnail?: boolean;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default definePlugin({
    name: "GDriveUploader",
    description: "10MB를 초과하는 파일을 Google Drive에 자동 업로드하고 링크를 채널에 전송합니다",
    authors: [Devs.Ven], // placeholder — replace with your own entry in Devs constant
    settings,

    // -------------------------------------------------------------------------
    // Webpack patch (Method A) — intercept Discord's uploadFiles at module load
    // -------------------------------------------------------------------------
    patches: [
        {
            find: "uploadFiles:",
            replacement: {
                // Match the uploadFiles function reference in Discord's upload module object
                match: /uploadFiles:(\i)/,
                replace: "uploadFiles:(...args)=>$self.handleUpload(...args,$1)",
            },
        },
        {
            // Discord's file input component validates size via maxFileSizeBytes prop.
            // When a file exceeds that limit, it sets ETOOLARGE on the input element and
            // the onChange handler calls the error modal — uploadFiles is never reached.
            // Setting maxFileSizeBytes to Infinity bypasses that early rejection so every
            // file flows through to uploadFiles, where our handleUpload patch intercepts it.
            find: "onFileSizeError",
            replacement: {
                match: /maxFileSizeBytes:(\i(?:\.\i)?)/,
                replace: "maxFileSizeBytes:Infinity",
            },
        },
    ],

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
});
