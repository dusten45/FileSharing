# Discord File Uploader

파일 또는 폴더를 선택하면 크기에 따라 자동으로 처리합니다.

| 조건 | 동작 |
|------|------|
| 파일/zip ≤ SIZE_LIMIT_MB | Discord Webhook으로 직접 전송 |
| 파일/zip > SIZE_LIMIT_MB | Google Drive에 업로드 후 링크를 Discord에 전송 |
| Discord 업로드 실패 | 자동으로 Google Drive로 fallback |
| 폴더 (원본 × 0.85 ≤ 기준) | zip 압축 후 크기 재확인 → Discord 직접 or Drive |
| 폴더 (원본 × 0.85 > 기준) | zip 없이 Drive에 폴더 구조 그대로 업로드 |

> PC 앱 + Android(Expo) 앱 모두 동일한 로직으로 동작합니다.

---

## 목차

1. [PC 앱 설정](#1-pc-앱-설정)
   - [Python 설치](#1-1-python-설치)
   - [패키지 설치](#1-2-패키지-설치)
   - [Discord Webhook 설정](#1-3-discord-webhook-설정)
   - [Google Drive API 설정](#1-4-google-drive-api-설정)
   - [.env 작성](#1-5-env-작성)
   - [최초 실행 및 Google 인증](#1-6-최초-실행-및-google-인증)
2. [Android 앱 설정 (Expo)](#2-android-앱-설정-expo)
   - [환경 준비](#2-1-환경-준비)
   - [Google OAuth 클라이언트 ID 생성 (Android용)](#2-2-google-oauth-클라이언트-id-생성-android용)
   - [앱 설정 및 실행](#2-3-앱-설정-및-실행)
3. [파일 구조](#3-파일-구조)
4. [주의사항](#4-주의사항)

---

## 1. PC 앱 설정

### 1-1. Python 설치

Python **3.11 이상** 필요. 설치 여부 확인:

```bash
python --version
```

[python.org](https://www.python.org/downloads/)에서 다운로드 가능합니다.

### 1-2. 패키지 설치

```bash
pip install -r requirements.txt
```

또는 [uv](https://github.com/astral-sh/uv) 사용 시:

```bash
uv sync
```

### 1-3. Discord Webhook 설정

1. Discord에서 파일을 올릴 **채널**로 이동
2. **채널 편집** (톱니바퀴 아이콘) → **연동** → **웹후크** → **새 웹후크**
3. 웹후크 이름 설정 후 **웹후크 URL 복사**
4. 복사한 URL을 `.env`에 붙여넣기 (아래 [1-5. .env 작성](#1-5-env-작성) 참조)

### 1-4. Google Drive API 설정

Google Drive 업로드 기능을 사용하려면 OAuth2 인증 파일이 필요합니다.

#### 3-1. Google Cloud 프로젝트 생성

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 상단 프로젝트 선택 드롭다운 → **새 프로젝트** → 이름 입력 후 만들기

#### 3-2. Google Drive API 활성화

1. 왼쪽 메뉴 **API 및 서비스** → **라이브러리**
2. `Google Drive API` 검색 → **사용 설정**

#### 3-3. OAuth 동의 화면 설정

1. **API 및 서비스** → **OAuth 동의 화면**
2. User Type: **외부** → **만들기**
3. 앱 이름(무관), 지원 이메일 입력 → **저장 후 계속** (나머지 단계도 기본값 유지)
4. **테스트 사용자** 탭 → **+ ADD USERS** → 본인 Google 계정 이메일 추가

#### 3-4. OAuth 클라이언트 ID 생성 (PC용 — 데스크톱 앱)

1. **API 및 서비스** → **사용자 인증 정보**
2. **+ 사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
3. 애플리케이션 유형: **데스크톱 앱** 선택
4. 생성 완료 후 **JSON 다운로드** 버튼 클릭
5. 다운로드된 파일을 **`credentials.json`** 으로 이름 바꾼 뒤 이 프로젝트 폴더에 복사

### 1-5. .env 작성

프로젝트 폴더에 `.env` 파일을 직접 만들거나 `env.example`을 복사해서 사용합니다.

```bash
# Windows
copy env.example .env

# macOS / Linux
cp env.example .env
```

`.env` 파일 내용:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
SIZE_LIMIT_MB=10
GDRIVE_CREDENTIALS_FILE=credentials.json
```

| 항목 | 설명 |
|------|------|
| `DISCORD_WEBHOOK_URL` | 위에서 복사한 Discord 웹후크 URL |
| `SIZE_LIMIT_MB` | 파일/zip 크기 기준 (기본값 10 MB). 이 값 이하면 Discord 직접, 초과면 Drive |
| `GDRIVE_CREDENTIALS_FILE` | Google OAuth 인증 파일 경로 (기본값 `credentials.json`) |

### 1-6. 최초 실행 및 Google 인증

```bash
python main.py
```

**최초 실행 시에만** 브라우저 창이 열리며 Google 계정 로그인을 요청합니다.

1. 브라우저에서 Google 계정 선택
2. "이 앱은 Google에서 확인하지 않았습니다" 경고가 뜨면 **고급** → **안전하지 않은 페이지로 이동** 클릭
3. **허용** 클릭

인증이 완료되면 `token.pickle`이 자동 생성되고, 이후 실행 시에는 브라우저 없이 자동 로그인됩니다.

---

## 2. Android 앱 설정 (Expo)

TODO

---

## 3. 파일 구조

```
FileSharing/
├── main.py                  # PC 앱 (Tkinter GUI)
├── requirements.txt         # Python 의존성
├── pyproject.toml
├── env.example              # .env 템플릿
├── .env                     # 실제 설정 (직접 생성, git 제외)
├── credentials.json         # Google OAuth 키 (직접 배치, git 제외)
├── token.pickle             # Google 인증 토큰 (자동 생성, git 제외)
└── mobile/                  # Android Expo 앱
    └── ???
```

---

## 4. 주의사항

- **`credentials.json`**, **`token.pickle`**, **`.env`** 는 절대 공유하거나 git에 올리지 마세요. (`.gitignore`에 이미 포함)
- Google Drive에 업로드된 파일/폴더는 **링크가 있는 모든 사람**이 뷰어 권한을 가지고 볼 수 있습니다. 편집은 불가능합니다.
- `SIZE_LIMIT_MB`는 `.env`에서 자유롭게 조정 가능합니다. Discord Webhook의 실제 업로드 한도는 서버 부스트 등급에 따라 다릅니다 (기본 10 MB, Tier 2: 50 MB, Tier 3: 100 MB).
- Google Cloud Console의 OAuth 동의 화면이 **테스트** 상태인 경우, 테스트 사용자로 추가된 계정만 인증이 가능합니다.
