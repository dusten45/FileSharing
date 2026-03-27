import { DataStore } from "@api/index";

const STORE_KEY = "GDriveUploader_tokens";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface Tokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Unix ms
}

async function exchangeCodeForToken(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectPort: number
): Promise<Tokens> {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: `http://localhost:${redirectPort}`,
            grant_type: "authorization_code",
        }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
    };
}

export async function startOAuthFlow(clientId: string, clientSecret: string): Promise<void> {
    const { code, port } = await VencordNative.pluginHelpers.GDriveUploader.startOAuthServer(clientId);
    const tokens = await exchangeCodeForToken(clientId, clientSecret, code, port);
    await DataStore.set(STORE_KEY, tokens);
}

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<Tokens> {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt: Date.now() + json.expires_in * 1000,
    };
}

export async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
    const tokens: Tokens | undefined = await DataStore.get(STORE_KEY);
    if (!tokens) throw new Error("Google 계정이 연결되지 않았습니다. 플러그인 설정에서 Google 계정을 연결해주세요.");

    // 만료 1분 전에 갱신
    if (Date.now() >= tokens.expiresAt - 60_000) {
        const refreshed = await refreshAccessToken(clientId, clientSecret, tokens.refreshToken);
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
        fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.accessToken}`, { method: "POST" }).catch(() => { });
    }
    await DataStore.del(STORE_KEY);
}
