// ── 설정 (여기만 수정하세요) ────────────────────────────────────────────────
const DISCORD_WEBHOOK_URL = "YOUR_DISCORD_WEBHOOK_URL";
const SIZE_LIMIT_MB       = 10;
const GDRIVE_CLIENT_ID    = "YOUR_GOOGLE_OAUTH_CLIENT_ID";
// ─────────────────────────────────────────────────────────────────────────────

import { registerRootComponent } from "expo";
import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

// ── 색상 (Discord 다크 테마) ──────────────────────────────────────────────────
const C = {
  dark:   "#1e1f22",
  panel:  "#2b2d31",
  accent: "#5865f2",
  green:  "#3ba55c",
  text:   "#dbdee1",
  muted:  "#949ba4",
  log:    "#1a1b1e",
};

// ── Google Drive OAuth ────────────────────────────────────────────────────────
const GDRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

const discovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint:         "https://oauth2.googleapis.com/token",
};

/** PKCE code_verifier: 43자 이상 URL-safe 랜덤 문자열 (RFC 7636) */
function generateCodeVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getGdriveToken(): Promise<string> {
  // Expo Go 개발 환경: useProxy: true → https://auth.expo.io 를 경유
  // 프로덕션 빌드 시: useProxy: false, scheme: "discordfileuploader" 로 변경
  const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });
  const codeVerifier = generateCodeVerifier();
  const request = new AuthSession.AuthRequest({
    clientId:            GDRIVE_CLIENT_ID,
    scopes:              GDRIVE_SCOPES,
    redirectUri,
    usePKCE:             true,
    codeChallenge:       codeVerifier,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.Plain,
  });
  const result = await request.promptAsync(discovery);
  if (result.type !== "success") throw new Error("Google 인증 취소됨");

  const tokenResp = await fetch(discovery.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code:          result.params.code,
      client_id:     GDRIVE_CLIENT_ID,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
      code_verifier: request.codeVerifier!,
    }).toString(),
  });
  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) throw new Error("토큰 발급 실패");
  return tokenData.access_token;
}

// ── Google Drive 파일 업로드 ──────────────────────────────────────────────────
async function uploadToDrive(
  uri: string,
  name: string,
  mimeType: string,
  token: string,
  onProgress: (pct: number) => void
): Promise<string> {
  // 메타데이터 + 파일 멀티파트 업로드
  const metadata = JSON.stringify({ name });
  const boundary = "foo_bar_baz";

  const fileResp = await fetch(uri);
  const fileBlob = await fileResp.blob();

  const body = new FormData();
  body.append("metadata", new Blob([metadata], { type: "application/json" }));
  body.append("file", fileBlob, name);

  const uploadResp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    }
  );
  const uploadData = await uploadResp.json();
  const fileId: string = uploadData.id;
  if (!fileId) throw new Error("Drive 업로드 실패");

  // 공개 링크 설정
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
}

// ── Discord 전송 ──────────────────────────────────────────────────────────────
async function discordUploadFile(uri: string, name: string, mimeType: string): Promise<boolean> {
  const fileResp = await fetch(uri);
  const fileBlob = await fileResp.blob();
  const form = new FormData();
  form.append("file", fileBlob, name);
  const resp = await fetch(DISCORD_WEBHOOK_URL, { method: "POST", body: form });
  return resp.ok;
}

async function discordSendLink(link: string, name: string, sizeMb: number): Promise<void> {
  await fetch(DISCORD_WEBHOOK_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `📁 **${name}**  \`${sizeMb.toFixed(1)} MB\`\n-# 파일이 너무 커서 Discord 대신 Google Drive에 업로드됐어요.\n${link}`,
    }),
  });
}

// ── 메인 업로드 로직 ──────────────────────────────────────────────────────────
async function processFile(
  uri: string,
  name: string,
  mimeType: string,
  sizeBytes: number,
  log: (msg: string) => void
): Promise<void> {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL === "YOUR_DISCORD_WEBHOOK_URL") {
    log("❌ DISCORD_WEBHOOK_URL을 설정해주세요 (index.tsx 상단).");
    return;
  }

  const sizeMb = sizeBytes / (1024 * 1024);
  log(`📄 ${name}  (${sizeMb.toFixed(2)} MB)`);
  log(`   기준 크기: ${SIZE_LIMIT_MB} MB`);

  if (sizeMb <= SIZE_LIMIT_MB) {
    log("⬆️  Discord에 직접 업로드 중...");
    const ok = await discordUploadFile(uri, name, mimeType);
    if (ok) {
      log("✅ Discord 업로드 완료!");
      return;
    }
    log("⚠️  Discord 직접 업로드 실패 → Google Drive로 전환...");
  } else {
    log(`   ${sizeMb.toFixed(1)} MB > ${SIZE_LIMIT_MB} MB → Google Drive 업로드`);
  }

  if (!GDRIVE_CLIENT_ID || GDRIVE_CLIENT_ID === "YOUR_GOOGLE_OAUTH_CLIENT_ID") {
    log("❌ GDRIVE_CLIENT_ID를 설정해주세요 (index.tsx 상단).");
    return;
  }

  log("  🔐 Google 인증 중...");
  const token = await getGdriveToken();
  log("  ☁️  Google Drive 업로드 중...");
  const link = await uploadToDrive(uri, name, mimeType, token, (pct) => {
    log(`  ⬆️  업로드 중... ${pct}%`);
  });
  log("💬 Discord에 링크 전송 중...");
  await discordSendLink(link, name, sizeMb);
  log("✅ 완료! Google Drive 링크가 Discord에 전송됐어요.");
}

// ── UI ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [logs, setLogs]     = useState<string[]>(["준비됨. 파일을 선택하면 자동으로 처리해요."]);
  const [busy, setBusy]     = useState(false);

  const log = (msg: string) => setLogs((prev) => [...prev, msg]);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setLogs((prev) => [...prev, "\n" + "─".repeat(32)]);
    setBusy(true);
    try {
      await processFile(
        asset.uri,
        asset.name,
        asset.mimeType ?? "application/octet-stream",
        asset.size ?? 0,
        log
      );
    } catch (e: any) {
      log(`❌ 오류: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.dark} />
      <View style={s.container}>
        <Text style={s.title}>Discord File Uploader</Text>
        <Text style={s.info}>
          {`≤ ${SIZE_LIMIT_MB} MB  →  Discord 직접 업로드\n> ${SIZE_LIMIT_MB} MB  →  Google Drive + 링크 전송`}
        </Text>

        <TouchableOpacity
          style={[s.btn, busy && s.btnDisabled]}
          onPress={pickFile}
          disabled={busy}
        >
          <Text style={s.btnText}>{busy ? "처리 중..." : "📂  파일 선택"}</Text>
        </TouchableOpacity>

        <View style={s.logContainer}>
          <ScrollView style={s.scroll} contentContainerStyle={{ padding: 10 }}>
            {logs.map((line, i) => (
              <Text key={i} style={s.logText}>{line}</Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.dark },
  container:    { flex: 1, padding: 20 },
  title:        { fontSize: 22, fontWeight: "bold", color: C.text, marginBottom: 6 },
  info:         { fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 20 },
  btn: {
    backgroundColor: C.accent,
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  btnDisabled:  { opacity: 0.5 },
  btnText:      { color: "#fff", fontSize: 16, fontWeight: "bold" },
  logContainer: { flex: 1, backgroundColor: C.log, borderRadius: 6 },
  scroll:       { flex: 1 },
  logText:      { color: C.text, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
});

registerRootComponent(App);
