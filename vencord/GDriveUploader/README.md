# GDriveUploader — Vencord 플러그인

Discord에서 파일을 첨부할 때 크기 제한(기본 10MB)을 초과하면, Discord가 업로드를 차단하는 대신
자동으로 **Google Drive**에 업로드하고 공유 링크를 채널에 전송합니다.

---

## 설치 방법

### 1. Vencord 설치

Vencord가 없다면 먼저 설치합니다.

1. [https://vencord.dev/download](https://vencord.dev/download) 에서 설치 프로그램 다운로드
2. 설치 프로그램 실행 → Discord 경로 자동 감지 → Install 클릭
3. Discord 재시작

### 2. 플러그인 파일 복사

Vencord의 **커스텀 플러그인 디렉토리**에 `GDriveUploader` 폴더를 복사합니다.

| OS | 커스텀 플러그인 경로 |
|---|---|
| Windows | `%APPDATA%\Vencord\plugins\` |
| macOS | `~/Library/Application Support/Vencord/plugins/` |
| Linux | `~/.config/Vencord/plugins/` |

```
Vencord/plugins/
└── GDriveUploader/
    ├── index.tsx
    ├── gdrive.ts
    ├── auth.ts
    └── README.md   ← 이 파일
```

### 3. 플러그인 활성화

1. Discord 열기 → 설정(⚙️) → **Vencord** 섹션 → **Plugins**
2. 목록에서 **GDriveUploader** 찾기 → 토글 활성화

---

## Google Cloud 설정

플러그인은 **Google Drive API**를 사용하므로, Google Cloud Console에서 OAuth 앱을 설정해야 합니다.

> 이미 이 프로젝트(FileSharing PC 앱 또는 Android 앱)의 Google Cloud 설정이 있다면,
> **같은 프로젝트를 재사용**할 수 있습니다. Step 3만 수행하세요.

### Step 1: Google Cloud 프로젝트 생성 (신규인 경우)

1. [https://console.cloud.google.com](https://console.cloud.google.com) 접속
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름 입력 후 생성

### Step 2: Google Drive API 활성화 (신규인 경우)

1. 좌측 메뉴 → **API 및 서비스** → **라이브러리**
2. "Google Drive API" 검색 → **사용 설정**

### Step 3: OAuth 클라이언트 ID 생성 또는 리다이렉트 URI 추가

**기존 `credentials.json`이 있는 경우 (재사용):**

1. **API 및 서비스** → **사용자 인증 정보**
2. 기존 OAuth 2.0 클라이언트 ID 클릭 (유형: 데스크톱 앱)
3. **승인된 리다이렉트 URI** → `http://localhost` 추가 → 저장

> `credentials.json`의 `client_id`와 `client_secret` 값을 아래 플러그인 설정에 입력합니다.

**새로 만드는 경우:**

1. **API 및 서비스** → **사용자 인증 정보** → **+ 사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
2. 애플리케이션 유형: **데스크톱 앱**
3. 이름 입력 후 만들기
4. **승인된 리다이렉트 URI** → `http://localhost` 추가 → 저장
5. 생성된 **클라이언트 ID**와 **클라이언트 보안 비밀번호** 복사

### Step 4: OAuth 동의 화면 설정 (신규인 경우)

1. **API 및 서비스** → **OAuth 동의 화면**
2. 사용자 유형: **외부** 선택 (개인 계정인 경우)
3. 앱 이름, 지원 이메일 입력 → 저장
4. **테스트 사용자** 탭 → 본인 Google 계정 이메일 추가

---

## 플러그인 설정

1. Discord 설정 → Vencord → Plugins → **GDriveUploader** 옆 ⚙️ 클릭
2. 아래 항목 입력:

| 항목 | 설명 |
|---|---|
| **크기 제한 (MB)** | 이 값 초과 시 Google Drive 업로드. 기본값 10 |
| **클라이언트 ID** | Google Cloud Console의 OAuth 클라이언트 ID |
| **클라이언트 시크릿** | Google Cloud Console의 클라이언트 보안 비밀번호 |

3. **Google 계정 연결** 버튼 클릭 → 브라우저에서 Google 로그인 → 권한 허용
4. "연결됨" 표시 확인

---

## 사용 방법

설정이 완료되면 별도 조작 없이 자동으로 동작합니다.

- **10MB 이하 파일**: 기존과 동일하게 Discord에 직접 업로드
- **10MB 초과 파일**: Google Drive에 자동 업로드 → 채널에 링크 메시지 전송

```
📁 example.zip  `45.2 MB`
-# 파일이 너무 커서 Discord 대신 Google Drive에 업로드됐어요.
https://drive.google.com/file/d/xxxxx/view
```

업로드 진행 중에는 화면 우측 하단에 진행률 알림이 표시됩니다.

---

## 기존 FileSharing 프로젝트와의 관계

이 플러그인은 [FileSharing](https://github.com/dusten45/filesharing) 프로젝트의 Discord 통합 버전입니다.

| 기능 | FileSharing PC/Android 앱 | GDriveUploader 플러그인 |
|---|---|---|
| 개별 파일 업로드 | ✅ | ✅ |
| 폴더 업로드 | ✅ | ❌ (Discord 미지원) |
| ZIP 압축 | ✅ | ❌ |
| Discord UI 통합 | ❌ | ✅ |
| Android 지원 | ✅ | ❌ |

**폴더 업로드 및 Android** 기능은 기존 앱을 계속 사용하세요.

---

## 문제 해결

**"클라이언트 ID/시크릿이 설정되지 않았습니다" 오류**
→ 플러그인 설정에서 클라이언트 ID와 시크릿을 입력했는지 확인하세요.

**"Google 계정이 연결되지 않았습니다" 오류**
→ 설정 패널의 "Google 계정 연결" 버튼을 클릭하세요.

**업로드 실패 / 인증 오류**
→ 설정 패널에서 "연결 해제" 후 다시 "Google 계정 연결"을 눌러 재인증하세요.

**Google Cloud에서 "액세스가 차단됨: 앱 확인 필요"**
→ OAuth 동의 화면에서 테스트 사용자에 본인 계정을 추가했는지 확인하세요 (Step 4).
