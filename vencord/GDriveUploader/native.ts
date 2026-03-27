import { createServer } from "http";
import type { AddressInfo } from "net";
import { IpcMainInvokeEvent, shell } from "electron";

const SCOPES = "https://www.googleapis.com/auth/drive.file";

/**
 * 로컬 HTTP 서버를 열어 OAuth 리다이렉트를 받고,
 * 브라우저로 Google 로그인 페이지를 연다.
 * 반환값(code, port)은 렌더러에서 토큰 교환에 사용한다.
 */
export async function startOAuthServer(
    _: IpcMainInvokeEvent,
    clientId: string
): Promise<{ code: string; port: number }> {
    return new Promise((resolve, reject) => {
        let port: number;

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
                    resolve({ code, port });
                }
            } catch (e) {
                res.end("<html><body>오류가 발생했습니다. 창을 닫아주세요.</body></html>");
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
}
