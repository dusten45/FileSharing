import { createServer } from "http";
import type { AddressInfo } from "net";
import { IpcMainInvokeEvent, shell } from "electron";

const SCOPES = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * 로컬 HTTP 서버를 열어 OAuth 리다이렉트를 받고,
 * 브라우저로 Google 로그인 페이지를 연다.
 * 인증 코드를 받은 뒤 메인 프로세스에서 직접 토큰 교환까지 수행한다.
 * (렌더러에서 fetch하면 Discord의 CSP에 의해 차단되므로 메인 프로세스에서 처리)
 */
export async function startOAuthFlow(
    _: IpcMainInvokeEvent,
    clientId: string,
    clientSecret: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
    const { code, port } = await new Promise<{ code: string; port: number }>((resolve, reject) => {
        let port: number;

        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url!, "http://localhost");
                const code = url.searchParams.get("code");
                const error = url.searchParams.get("error");

                if (error) {
                    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>인증 실패: ${error}. 창을 닫아주세요.</body></html>`);
                    server.close();
                    reject(new Error(`OAuth error: ${error}`));
                    return;
                }
                if (code) {
                    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                    res.end("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>인증 완료! 창을 닫아주세요.<script>window.close();</script></body></html>");
                    server.close();
                    resolve({ code, port });
                }
            } catch (e) {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>오류가 발생했습니다. 창을 닫아주세요.</body></html>");
                server.close();
                reject(e);
            }
        });

        server.listen(0, () => {
            port = (server.address() as AddressInfo).port;

            const params = new URLSearchParams({
                client_id: clientId,
                redirect_uri: `http://localhost:${port}`,
                response_type: "code",
                scope: SCOPES,
                access_type: "offline",
                prompt: "consent",
            });

            shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
        });
    });

    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: `http://localhost:${port}`,
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

/**
 * 메인 프로세스에서 액세스 토큰을 갱신한다.
 * (렌더러에서 fetch하면 Discord의 CSP에 의해 차단되므로 메인 프로세스에서 처리)
 */
export async function refreshTokens(
    _: IpcMainInvokeEvent,
    clientId: string,
    clientSecret: string,
    refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
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
