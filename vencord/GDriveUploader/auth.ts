import { DataStore } from "@api/index";

const STORE_KEY = "GDriveUploader_tokens";

export interface Tokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Unix ms
}

export async function startOAuthFlow(clientId: string, clientSecret: string): Promise<void> {
    const tokens = await VencordNative.pluginHelpers.GDriveUploader.startOAuthFlow(clientId, clientSecret);
    await DataStore.set(STORE_KEY, tokens);
}

export async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
    const tokens: Tokens | undefined = await DataStore.get(STORE_KEY);
    if (!tokens) throw new Error("Google 계정이 연결되지 않았습니다. 플러그인 설정에서 Google 계정을 연결해주세요.");

    // Refresh 1 minute before expiry
    if (Date.now() >= tokens.expiresAt - 60_000) {
        const refreshed = await VencordNative.pluginHelpers.GDriveUploader.refreshTokens(
            clientId, clientSecret, tokens.refreshToken
        );
        await DataStore.set(STORE_KEY, refreshed);
        return refreshed.accessToken;
    }

    return tokens.accessToken;
}

export async function isAuthenticated(): Promise<boolean> {
    const tokens: Tokens | undefined = await DataStore.get(STORE_KEY);
    return tokens != null;
}

export async function revokeTokens(): Promise<void> {
    const tokens: Tokens | undefined = await DataStore.get(STORE_KEY);
    if (tokens) {
        // Best-effort revocation
        fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.accessToken}`, { method: "POST" }).catch(() => { });
    }
    await DataStore.del(STORE_KEY);
}
