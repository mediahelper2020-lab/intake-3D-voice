# 복지인사이트 Case-IN

노인 초기면접·선정기준 관리를 위한 브라우저 기반 앱입니다. 데이터는 사용자의 브라우저 IndexedDB(`welfare_insight_intake_v1`)에만 저장됩니다.

## Case-IN Voice (AI 음성 초기면접)

`🎙 AI 초기면접` 버튼으로 실행되는 음성 대화형 초기면접 보조 기능입니다.

- 대상자와 AI가 음성으로 자연스럽게 대화하며 초기면접 정보를 파악합니다.
- AI가 파악한 내용은 화면에서 실시간으로 확인/추가확인 상태로 표시됩니다.
- **AI는 결과를 바로 저장하지 않습니다.** 면접 종료 후 사회복지사가 검토·수정하고 `사회복지사 확인 및 저장`을 눌러야 Case-IN 기록에 반영됩니다.
- 주민등록번호·상세주소·전화번호 등은 AI에게 전달되지 않으며, 음성 원본과 대화 전문은 저장되지 않습니다.
- 구현 파일: `voice/*.js`, `voice/voice-styles.css` (프론트엔드), `api/voice-session.js`, `api/interview-summary.js` (서버리스, OpenAI 키 보관)

### 배포 (Vercel)

1. 이 저장소를 Vercel 프로젝트로 연결합니다. 별도 빌드 설정이 필요 없습니다(정적 `index.html` + `api/` 서버리스 함수).
2. Vercel 프로젝트의 **Settings → Environment Variables**에 `OPENAI_API_KEY`를 등록합니다. (`.env.example` 참고)
3. 배포 후 `🎙 AI 초기면접` 버튼이 정상 동작하는지 마이크 권한을 허용한 브라우저에서 확인합니다.

OpenAI API 키는 절대 브라우저 코드에 포함되지 않으며, 서버 환경변수로만 존재합니다. 브라우저는 `/api/voice-session`이 발급한 단명(ephemeral) 토큰으로만 OpenAI Realtime API와 직접 연결합니다.
