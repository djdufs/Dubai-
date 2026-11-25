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

## Supabase
- Project ref와 키는 `index.html` 상단 `SUPA`, `SUPA_KEY` 상수에 있다. **Publishable 키만** 프론트에 쓰고 Secret Key는 절대 넣지 않는다.
- 스키마·RLS·Storage 정책: [`supabase/schema.sql`](supabase/schema.sql)
  - 테이블 `dubai_places`, `dubai_notes`, `dubai_checklist` (RLS: anon/authenticated 전체 허용 — 두 사람만 아는 링크 공유 전제)
  - Storage 버킷 `dubai-photos` (public, 읽기/쓰기/삭제 정책 포함)
- 테이블이 없거나 연결이 안 되면 사이트는 자동으로 **이 기기 저장(localStorage)** 모드로 떨어지고 상단에 안내 배너가 뜬다.

## Edge Function `dubai-ai`
- `supabase/functions/dubai-ai/index.ts` (Deno, `verify_jwt: false`, CORS `*`)
- `GEMINI_API_KEY`는 Supabase 프로젝트 Secrets에만 등록한다(코드·저장소 금지).
- 모델: `gemini-3.1-flash-lite` 1순위 → `gemini-3.5-flash` 폴백. 입력 `{messages, context}`.

## 스크린샷
| 파일 | 내용 |
|---|---|
| `screenshots/01-홈-대시보드-듀얼시계-항공편.png` | 듀얼 시계·D-10·항공편 카드 |
| `screenshots/02-장소-등록-목록.png` | 장소 목록·추천 스팟 |
| `screenshots/03-지도-핀-길찾기.png` | 지도 핀(공항·숙소) |
| `screenshots/04-아랍맨-AI상담.png` | 아랍맨 대화(실제 응답) |
| `screenshots/05-택시카드-큰글씨.png` | 택시 카드 큰 글씨 |
| `screenshots/06-커플톡-사진.png` | 커플 톡·사진 |

## 수정·배포
```bash
git clone https://github.com/djdufs/Dubai-.git && cd Dubai-
# index.html 수정 → main 푸시 → 1~2분 뒤 GitHub Pages 반영
git add -A && git commit -m "..." && git push origin main
```
