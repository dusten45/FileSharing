# Discord File Uploader — 설정 가이드

파일을 선택하면 크기에 따라 자동으로 처리합니다.

- **설정 크기 이하** → Discord Webhook으로 직접 파일 전송
- **설정 크기 초과** → Google Drive에 업로드 후 뷰어 링크를 Discord에 전송
- **Discord 업로드 실패 시** → 자동으로 Google Drive fallback

---

## 1. Python 패키지 설치

```bash
pip install -r requirements.txt
```

---

## 2. Discord Webhook 설정

1. Discord에서 파일을 올릴 채널로 이동
2. **채널 편집** (톱니바퀴) → **연동** → **웹후크** → **새 웹후크**
3. 웹후크 이름 설정 후 **웹후크 URL 복사**
4. `.env.example`을 `.env`로 복사 후 URL 붙여넣기

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

---

## 3. Google Drive API 설정

### 3-1. Google Cloud 프로젝트 생성
1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. **새 프로젝트** 생성 (이름 무관)

### 3-2. Google Drive API 활성화
1. **API 및 서비스** → **라이브러리**
2. "Google Drive API" 검색 → **사용 설정**

### 3-3. OAuth 동의 화면 설정
1. **API 및 서비스** → **OAuth 동의 화면**
2. User Type: **외부** → 만들기
3. 앱 이름/이메일 입력 → 저장 후 계속 (나머지는 기본값)
4. **테스트 사용자** 탭 → 본인 Google 계정 추가

### 3-4. OAuth 클라이언트 ID 생성
1. **API 및 서비스** → **사용자 인증 정보**
2. **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
3. 애플리케이션 유형: **데스크톱 앱**
4. 생성 후 **JSON 다운로드**
5. 다운로드된 파일을 `credentials.json`으로 이름 바꾼 뒤 이 폴더에 복사

---

## 4. .env 설정

`.env.example`을 `.env`로 복사하고 값 입력:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
SIZE_LIMIT_MB=10
GDRIVE_CREDENTIALS_FILE=credentials.json
```

---

## 5. 최초 실행 (Google 인증)

```bash
python main.py
```

처음 실행 시 브라우저가 열리면서 Google 계정 인증을 요청합니다.
허용하면 `token.pickle` 파일이 생성되고, 이후로는 자동 로그인됩니다.

---

## 파일 구조

```
discord_uploader/
├── main.py              # 메인 앱
├── requirements.txt
├── .env                 # 설정 (직접 생성)
├── .env.example         # 설정 예시
├── credentials.json     # Google OAuth 키 (직접 배치)
└── token.pickle         # Google 인증 토큰 (자동 생성)
```

---

## 주의사항

- `credentials.json`과 `token.pickle`은 절대 공유하지 마세요.
- Google Drive에 업로드된 파일은 **링크가 있는 모든 사람**이 볼 수 있습니다.
- 크기 기준은 `.env`의 `SIZE_LIMIT_MB` 값으로 자유롭게 조정 가능합니다.