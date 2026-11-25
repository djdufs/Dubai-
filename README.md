# 🇦🇪 두바이 출장 가이드 (건우 · 12.5–12.12)

남자친구 **고건우** 님의 두바이 출장(2026-12-05 ~ 2026-12-12)을 위한 공유 웹 가이드.
영진 님이 숙소·출장지·스팟을 등록하면 건우 님 기기에서도 같은 화면으로 보인다.

- **사이트**: https://djdufs.github.io/Dubai-/
- 정적 `index.html` 한 장 + PWA(`manifest.json`, `sw.js`, 아이콘)

## 항공
| 구분 | 편명 | 출발 | 도착 | 기재 |
|---|---|---|---|---|
| 출국 | KE5951 (에미레이트 운항) | 12.5(토) 23:40 인천 T1 | 12.6(일) 05:05 두바이 T3 | A380-800, 10h 25m |
| 귀국 | KE5952 | 12.12(토) 03:30 두바이 T3 | 12.12(토) 16:55 인천 T1 | A380-800, 8h 25m |

## 기능
1. **듀얼 시계** — 서울(KST) / 두바이(GST, -5h) 실시간, 출국·체류·귀국 D-Day 카운트다운, 항공편 카드
2. **장소 등록/수정/삭제** — 숙소 / 출장지 / 맛집·카페 / 관광·쇼핑. OpenStreetMap(Nominatim) 주소 검색으로 위·경도 자동 채움, 좌표 직접 입력, 체크인·방문 시간, 예약번호·메모. Supabase에 저장되어 두 기기에서 20초 폴링으로 동기화
3. **지도(Leaflet + CARTO dark)** — 구분별 색상 핀, 핀/카드에서 Google Maps 길찾기
4. **두바이 날씨** — Open-Meteo 현재·7일 예보 + 12월 복장 가이드
5. **환율 계산기** — AED↔KRW, 실시간 환율(open.er-api.com) 실패 시 기본값/직접 수정
6. **택시·주문 카드** — 등록한 숙소·출장지 주소를 큰 글씨 화면으로 (아랍어·영어 문구 포함), 아랍어 생존 문구 복사
7. **아랍맨 AI 상담** — 우측 하단 아바타 FAB("도와줘요 아랍맨! 🐫") → 바텀시트 대화. Gemini Edge Function `dubai-ai`가 사이트의 실시간 데이터(항공편·등록 장소·날씨·환율·준비물·톡)를 컨텍스트로 받아 한국어 반말로 답한다. 빠른 질문 칩 4종.
8. **커플 톡·사진첩** — 접속자 선택(건우/영진, sessionStorage), 메모·사진(1400px JPEG 0.82 압축 후 Storage 업로드)
9. **출장 준비물 체크리스트** — 공유 체크 상태
10. **아랍어 생존 문구 10종 — `🔊` 발음 듣기** (생존 탭) — 고정 문구마다 아랍어 원문·로마자 발음·복사·`🔊` 버튼. 음성은 레포에 박제된 MP3(`assets/audio/phrase-01.mp3`~`phrase-10.mp3`, `ar-AE-HamdanNeural`)를 재생하고, MP3 로드가 실패하면 서버 TTS로 이어서 재생한다(마지막에만 `speechSynthesis`).
11. **실시간 번역기** (생존 탭 하단) — 한국어/영어 입력 → 아랍어 원문(로마자 발음)·영어 표현·현지 한 줄 팁. `dubai-ai` 함수에 `mode:'translate'`로 보내고 프론트 `parseTrJSON()`이 파싱한다. 결과는 `🔊 듣기` · `복사` · `다시`, 같은 문장은 `localStorage`에 캐시.
    - `🔊 듣기`는 **서버 TTS**(`mode:'tts'`)로 받은 아랍어 오디오를 재생한다 — 기기에 아랍어 음성팩이 없어도 소리가 난다. 버튼은 `⏳ 준비 중…` → `⏸ 멈추기`로 바뀌고, 받은 오디오는 문장별 메모리 캐시(최대 12개 blob URL)라 다시 누르면 즉시 재생된다. 실패했을 때만 "다시 눌러 주세요" 토스트가 뜬다.

## Supabase
- Project ref와 키는 `index.html` 상단 `SUPA`, `SUPA_KEY` 상수에 있다. **Publishable 키만** 프론트에 쓰고 Secret Key는 절대 넣지 않는다.
- 스키마·RLS·Storage 정책: [`supabase/schema.sql`](supabase/schema.sql)
  - 테이블 `dubai_places`, `dubai_notes`, `dubai_checklist` (RLS: anon/authenticated 전체 허용 — 두 사람만 아는 링크 공유 전제)
  - Storage 버킷 `dubai-photos` (public, 읽기/쓰기/삭제 정책 포함)
- 테이블이 없거나 연결이 안 되면 사이트는 자동으로 **이 기기 저장(localStorage)** 모드로 떨어지고 상단에 안내 배너가 뜬다.

## Edge Function `dubai-ai`
- `supabase/functions/dubai-ai/index.ts` (Deno, `verify_jwt: false`, CORS `*`)
- `GEMINI_API_KEY`는 Supabase 프로젝트 Secrets에만 등록한다(코드·저장소 금지).
- `mode` 세 갈래: 없음/`chat`(아랍맨 상담, 입력 `{messages, context}`), `translate`(번역기, JSON 한 개), `tts`(아랍어 오디오, 입력 `{text, lang?, voice?}`).
- 모델: `gemini-3.1-flash-lite` 1순위 → `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.5-flash`. 1순위가 3.5초 안에 답하지 않으면 다음 모델을 **함께 출발**시키고(먼저 성공한 응답 채택), 한 번 시도는 12초에서 끊는다 — 특정 모델이 503(과부하)일 때 전체가 붙잡히지 않게.
- `mode:'translate'`는 전용 시스템 프롬프트(걸프 방언 톤, temperature 0.2)로 JSON만 돌려준다.
- `mode:'tts'` 응답: `{ok, engine, mime, bytes, ms, audio(base64)}` (+ 캐시 hit이면 `cached:true`). 실측 2~3초, 3초 분량 WAV ≈ 180KB(base64 240KB). 같은 텍스트는 함수 인스턴스 메모리에 캐시(≤6MB).
- 번역기는 같은 함수를 그대로 쓴다. 서버는 `mode` 필드를 무시하므로, 요청 본문에 `mode:'translate'`와 JSON만 출력하라는 지시 프롬프트를 넣고 프론트 `parseTrJSON()`이 `{arabic, pronunciation, english, tip}`을 파싱한다(코드펜스·앞뒤 잡설은 잘라냄). 응답은 보통 1~2초, 모델 폴백 시 수 초 걸릴 수 있어 25초 타임아웃 + `다시 시도` 버튼을 둔다.

## 오디오(`assets/audio/`)
- 10개 생존 문구의 아랍어 발음 MP3. 생성: `pip install edge-tts` → `edge-tts`의 `ar-AE-HamdanNeural`(rate `-8%`), 24kHz 모노.
- `sw.js` 셸 캐시(`dubai-shell-v3`)에 포함되어 오프라인에서도 재생된다. 문구를 바꿀 때는 `index.html`의 `PHRASES`와 MP3를 같이 갱신한다.
- `silent.wav` — iOS가 제스처 밖 `play()`를 막는 문제를 피하려고 첫 터치에서 이 무음 파일로 오디오 요소를 미리 열어 두는 용도(50ms).
- 번역기·MP3 실패 폴백 음성은 서버에서 만든다: **Gemini TTS `gemini-3.8-flash-tts`**(voice `Sadaltager`, `audio/wav` 반환) 1순위 → `gemini-3.8-flash-lite-tts` / `gemini-3.1-flash-tts-preview` / `gemini-2.5-flash-preview-tts`(PCM 24kHz에 WAV 헤더 부착) → 최종 폴백 구글 번역 음성(`translate_tts`, MP3). TTS 모델·보이스는 `GEMINI_TTS_MODEL`·`GEMINI_TTS_VOICE` Secret으로 바꿀 수 있다.

## 스크린샷
| 파일 | 내용 |
|---|---|
| `screenshots/01-홈-대시보드-듀얼시계-항공편.png` | 듀얼 시계·D-10·항공편 카드 |
| `screenshots/02-장소-등록-목록.png` | 장소 목록·추천 스팟 |
| `screenshots/03-지도-핀-길찾기.png` | 지도 핀(공항·숙소) |
| `screenshots/04-아랍맨-AI상담.png` | 아랍맨 대화(실제 응답) |
| `screenshots/05-택시카드-큰글씨.png` | 택시 카드 큰 글씨 |
| `screenshots/06-커플톡-사진.png` | 커플 톡·사진 |
| `screenshots/07-아랍어-생존문구-발음듣기-MP3.png` | 생존 문구 10개 + 🔊 재생 중(첫 행 하이라이트) |
| `screenshots/08-실시간-번역기-결과.png` | 실시간 번역기 — 실제 번역 결과(아랍어·로마자·영어·팁) |
| `screenshots/09-실시간-번역기-서버TTS-듣기-재생중.png` | `🔊 듣기` → 서버 TTS 재생 중(`⏸ 멈추기`) |

## 수정·배포
```bash
git clone https://github.com/djdufs/Dubai-.git && cd Dubai-
# index.html 수정 → main 푸시 → 1~2분 뒤 GitHub Pages 반영
git add -A && git commit -m "..." && git push origin main
```
