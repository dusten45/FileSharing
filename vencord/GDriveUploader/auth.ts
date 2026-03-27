import { DataStore } from "@api/index";
import { createServer } from "http";
import type { AddressInfo } from "net";

const STORE_KEY = "GDriveUploader_tokens";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

export interface Tokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Unix ms
}

function buildOAuthUrl(clientId: string, redirectPort: number): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://localhost:${redirectPort}`,
        response_type: "code",
        scope: SCOPES,
        access_type: "offline",
        prompt: "consent",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
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
    const tokens = await new Promise<Tokens>((resolve, reject) => {
        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url!, "http://localhost");
                const code = url.searchParams.get("code");
                const error = url.searchParams.get("error");

                if (error) {
                    res.end(`<html><body>인증 실패: ${error}. 창을 닫아주세요.</body></html>`);
                    server.close();
                    reject(new Error(`OAuth error: ${error}`));
                    return;
                }
                if (code) {
                    res.end("<html><body><script>window.close()</script>인증 완료! 창을 닫아주세요.</body></html>");
                    server.close();
                    const t = await exchangeCodeForToken(clientId, clientSecret, code, port);
                    resolve(t);
                }
            } catch (e) {
                res.end("<html><body>오류가 발생했습니다. 창을 닫아주세요.</body></html>");
                server.close();
                reject(e);
            }
        });

        server.listen(0);
        const port = (server.address() as AddressInfo).port;

        // Open browser for Google login
        // electron.shell is available in Vencord's Electron context
        try {
            const { shell } = require("electron");
            shell.openExternal(buildOAuthUrl(clientId, port));
        } catch {
            // Fallback: open via window.open (works in web mode)
            window.open(buildOAuthUrl(clientId, port), "_blank");
        }
    });

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
        refreshToken: json.refresh_token ?? refreshToken, // refresh_token may not be returned again
        expiresAt: Date.now() + json.expires_in * 1000,
    };
}

export async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
    const tokens: Tokens | undefined = await DataStore.get(STORE_KEY);
    if (!tokens) throw new Error("Google 계정이 연결되지 않았습니다. 플러그인 설정에서 Google 계정을 연결해주세요.");

    // Refresh 1 minute before expiry
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
        // Best-effort revocation
        fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.accessToken}`, { method: "POST" }).catch(() => { });
    }
    await DataStore.del(STORE_KEY);
}
