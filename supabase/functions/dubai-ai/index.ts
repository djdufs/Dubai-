// 두바이 출장 가이드 — "아랍맨" AI 상담 + 아랍어 TTS Edge Function
// GEMINI_API_KEY는 Supabase Secret에만 있고 이 코드/저장소에는 절대 넣지 않는다.
// 배포: Supabase Management API POST /v1/projects/{ref}/functions (또는 supabase functions deploy dubai-ai --no-verify-jwt)
//
// mode 생략     : 아랍맨 상담 채팅 (기존 동작 그대로)
// mode:'translate': 실시간 번역기 — JSON 한 개만 반환
// mode:'tts'    : 아랍어 문장 → 오디오(base64). 기기 음성팩 없이 재생되도록 서버에서 생성.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

const PRIMARY_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite';
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const MODEL_TIMEOUT_MS = 12000;   // 모델 한 번 시도 상한 — 느린 모델이 전체를 붙잡지 않게
const HEDGE_MS = 3500;            // 1순위가 이만큼 안 답하면 다음 모델도 동시에 출발

// TTS: 파일을 바로 주는 모델(audio/wav) 우선, 안 되면 PCM(래핑) → 마지막엔 구글 번역 음성(MP3)
const TTS_MODELS = [
  Deno.env.get('GEMINI_TTS_MODEL') || 'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts'
].filter(Boolean);
const TTS_VOICE = Deno.env.get('GEMINI_TTS_VOICE') || 'Sadaltager'; // 아랍어 남성 톤
const TTS_MAX_CHARS = 480;
const TTS_CACHE_MAX_BYTES = 6 * 1024 * 1024;

const MAX_MSGS = 12;
const MAX_MSG_CHARS = 2000;
const MAX_CONTEXT_CHARS = 14000;

type Msg = { role: 'user' | 'assistant' | 'model'; content: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function clip(s: unknown, n: number): string {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function b64(bytes: Uint8Array): string {
  let out = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    out += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(out);
}

function buildSystemPrompt(context: unknown): string {
  let ctx = '';
  try {
    ctx = JSON.stringify(context ?? {}, null, 1);
  } catch {
    ctx = '{}';
  }
  if (ctx.length > MAX_CONTEXT_CHARS) ctx = ctx.slice(0, MAX_CONTEXT_CHARS) + '\n…(이하 생략)';

  return [
    '너는 "아랍맨"이다. 2026년 12월 5일~12일 고건우 님의 두바이 출장(그리고 연인 영진 님과 함께 쓰는 공유 가이드)을 돕는, 두바이 현지 사정에 훤한 스마트하고 유쾌한 AI 가이드다.',
    '두바이 현지인처럼 사막·금·향신료 냄새 나게 말하되, 답은 정확하고 실용적으로. 한국어 반말로 말한다.',
    '아래 [실시간 데이터]는 지금 이 순간 사이트에 들어 있는 실제 값이다. 비행 일정(KE5951/KE5952), 등록된 숙소·출장지·스팟, 오늘 두바이 날씨, 환율, 에티켓·택시 팁 질문에는 반드시 이 데이터를 근거로 답한다. 데이터에 없는 값(미등록 숙소·주소, 확인되지 않은 영업시간·요금)은 지어내지 말고 "사이트에 아직 등록 안 됐어"라고 말한 뒤 어디에 넣으면 되는지 알려준다.',
    '',
    '[답변 규칙]',
    '1. 한국어 반말, 3~6줄 이내로 핵심만. 인사말·서론 없이 바로 본론.',
    '2. 필요하면 • 불릿 2~4개. 모바일이라 마크다운 표는 쓰지 않는다. 코드펜스·JSON을 그대로 노출하지 않는다.',
    '3. 시각·날짜는 두바이 시간(GST, UTC+4)과 한국 시간(KST)을 구분해 말한다. 시차는 -5시간.',
    '4. 이동 안내는 등록된 장소 기준으로, 지하철(메트로)·택시·도보를 비교해서 말하고 대략 소요시간을 준다. 공항은 T3 기준.',
    '5. 날씨는 데이터의 기온·체감·습도·바람을 그대로 인용하고, 12월 두바이는 낮 덥고 밤 선선하며 실내 에어컨이 강하다는 점을 복장 조언에 연결한다. 한낮 자외선이 매우 강하다는 것도 짚는다.',
    '6. 에티켓(복장, 촬영, 애정표현, 주류, 라마단), 택시·Careem, Nol 카드, 팁 문화는 두바이 규정에 맞게 정확히 말한다.',
    '7. 택시 기사에게 보여줄 문구를 물으면 아랍어 원문 + 한국어 발음 + 영어를 함께 짧게 준다.',
    '8. 모르면 모른다고 하고, 사이트 어느 카드에서 확인하면 되는지 알려준다. 의료·법률·비자 같은 민감한 판단은 공식 기관 확인을 권한다.',
    '9. 이모지는 1~2개만. 아랍맨다운 말투("사막의 법칙", "금빛 도시에서는" 같은 표현)를 한 번 정도만 가볍게 섞고 과하지 않게.',
    '',
    '[실시간 데이터]',
    ctx
  ].join('\n');
}

const TRANSLATE_SYSTEM_PROMPT = [
  '너는 두바이 현지 통역기다. 사용자가 준 한국어(또는 영어) 문장을 택시 기사·호텔 직원·상점 점원에게 그대로 보여줄 수 있는 자연스러운 아랍어(걸프 방언 톤)로 옮긴다.',
  '명령·요청은 공손한 명령형으로, 고유명사(장소·호텔·역 이름)는 영어 표기를 아랍 문자로 음역한다.',
  '',
  '[출력 형식]',
  '설명·인사·마크다운·코드펜스 없이 아래 JSON 객체 하나만 출력한다.',
  '{"arabic":"아랍어 원문","pronunciation":"아랍어를 로마자(라틴 알파벳)로 적은 발음","english":"영어 표현","tip":"한국어 한 줄 현지 팁(30자 이내)"}'
].join('\n');

function toGeminiContents(messages: Msg[]) {
  const list = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MSGS)
    .map((m) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: clip(m.content, MAX_MSG_CHARS) }]
    }));
  while (list.length && list[0].role === 'model') list.shift();
  return list;
}

async function callGemini(
  model: string,
  key: string,
  systemPrompt: string,
  contents: unknown,
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {}
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.75,
      topP: 0.95,
      maxOutputTokens: opts.maxTokens ?? 1024,
      thinkingConfig: { thinkingBudget: 0 }
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: opts.signal
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: r.status, data };
}

function extractText(data: any): string {
  const c = data?.candidates?.[0];
  const parts = c?.content?.parts || [];
  return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
}

/** 채팅/번역 공통 — 모델 폴백 체인 (1순위가 느리면 다음 모델을 앞당겨 함께 출발) */
async function runText(
  key: string,
  systemPrompt: string,
  contents: unknown,
  opts: { temperature?: number; maxTokens?: number } = {}
) {
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
  const tried: string[] = [];
  const controllers: AbortController[] = [];

  return await new Promise<any>((resolve) => {
    let done = false;
    let next = 0;
    let launched = 0;
    let settled = 0;
    let lastErr = '';
    const startedAt = Date.now();

    const finish = (v: any) => {
      if (done) return;
      done = true;
      for (const c of controllers) {
        try {
          c.abort();
        } catch { /* noop */ }
      }
      resolve(v);
    };

    const launch = () => {
      if (done || next >= models.length) return;
      const model = models[next++];
      tried.push(model);
      launched++;
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const killer = setTimeout(() => {
        try {
          ctrl.abort();
        } catch { /* noop */ }
      }, MODEL_TIMEOUT_MS);
      const t0 = Date.now();
      callGemini(model, key, systemPrompt, contents, { ...opts, signal: ctrl.signal })
        .then((res) => {
          if (done) return;
          const reply = res.status === 200 ? extractText(res.data) : '';
          if (reply) {
            finish({ ok: true, reply, model: res.data?.modelVersion || model, usage: res.data?.usageMetadata || null, ms: Date.now() - t0, total_ms: Date.now() - startedAt, tried });
            return;
          }
          lastErr = res.status === 200
            ? `empty_candidate:${JSON.stringify(res.data?.candidates?.[0]?.finishReason || '')}`
            : `http_${res.status}:${clip(res.data?.error?.message || '', 200)}`;
          settled++;
          launch();
          if (!done && settled >= launched && next >= models.length) {
            finish({ ok: false, error: 'upstream_failed', detail: lastErr, tried });
          }
        })
        .catch((e) => {
          if (done) return;
          lastErr = `fetch_failed:${String(e).slice(0, 140)}`;
          settled++;
          launch();
          if (!done && settled >= launched && next >= models.length) {
            finish({ ok: false, error: 'upstream_failed', detail: lastErr, tried });
          }
        })
        .finally(() => clearTimeout(killer));

      setTimeout(() => launch(), HEDGE_MS);
    };

    launch();
  });
}

/* ================= TTS ================= */

type Audio = { bytes: Uint8Array; mime: string; engine: string };

const TTS_MEM = new Map<string, Audio>();
let TTS_MEM_BYTES = 0;

function memGet(k: string): Audio | null {
  return TTS_MEM.get(k) || null;
}
function memSet(k: string, v: Audio) {
  if (v.bytes.length > TTS_CACHE_MAX_BYTES) return;
  while (TTS_MEM_BYTES + v.bytes.length > TTS_CACHE_MAX_BYTES && TTS_MEM.size) {
    const firstKey = TTS_MEM.keys().next().value as string;
    const old = TTS_MEM.get(firstKey);
    TTS_MEM.delete(firstKey);
    if (old) TTS_MEM_BYTES -= old.bytes.length;
  }
  TTS_MEM.set(k, v);
  TTS_MEM_BYTES += v.bytes.length;
}

/** 16bit PCM mono → WAV */
function wrapWav(pcm: Uint8Array, rate = 24000, channels = 1, bits = 16): Uint8Array {
  const byteRate = (rate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const header = new Uint8Array(44);
  const dv = new DataView(header.buffer);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[off + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  ascii(36, 'data');
  dv.setUint32(40, pcm.length, true);
  const out = new Uint8Array(header.length + pcm.length);
  out.set(header, 0);
  out.set(pcm, header.length);
  return out;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function pcmRateFromMime(mime: string): number {
  const m = /rate=(\d+)/i.exec(mime || '');
  return m ? Number(m[1]) : 24000;
}

/** Gemini TTS — 실패하면 null (다음 모델/폴백으로) */
async function geminiTts(model: string, key: string, text: string, voice: string): Promise<Audio | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`tts_http_${r.status}:${clip(t, 160)}`);
  }
  const d = await r.json();
  const parts = d?.candidates?.[0]?.content?.parts || [];
  const inline = parts.map((p: any) => p?.inlineData).find((x: any) => x?.data);
  if (!inline?.data) throw new Error('tts_no_audio');
  const mime = String(inline.mimeType || '');
  const raw = fromBase64(inline.data);
  if (!raw.length) throw new Error('tts_empty_audio');
  if (/wav/i.test(mime)) return { bytes: raw, mime: 'audio/wav', engine: model };
  // L16 / pcm → WAV 헤더 부착
  return { bytes: wrapWav(raw, pcmRateFromMime(mime), /channels=2/i.test(mime) ? 2 : 1, 16), mime: 'audio/wav', engine: `${model}(pcm→wav)` };
}

/** 폴백: 구글 번역 음성(MP3). 200자 제한이라 문장 단위로 나눠 이어 붙인다. */
function chunkForGtts(text: string, max = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    // 아랍어 문장부호/공백 기준으로 자른다
    let cut = -1;
    for (const re of [/[.؟?!،؛:]\s/g, /\s/g]) {
      let m: RegExpExecArray | null;
      const r2 = new RegExp(re.source, 'g');
      while ((m = r2.exec(rest))) {
        const idx = m.index + m[0].length;
        if (idx <= max) cut = idx;
      }
      if (cut > 0) break;
    }
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

async function googleTranslateTts(text: string, lang = 'ar'): Promise<Audio> {
  const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
  const chunks = chunkForGtts(text);
  const bufs: Uint8Array[] = [];
  for (const c of chunks) {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&ttsspeed=0.9&tl='
      + encodeURIComponent(lang) + '&q=' + encodeURIComponent(c);
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://translate.google.com/' },
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) throw new Error(`gtts_http_${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length < 512) throw new Error('gtts_too_small');
    bufs.push(b);
  }
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) {
    out.set(b, off);
    off += b.length;
  }
  return { bytes: out, mime: 'audio/mpeg', engine: 'google-translate-tts' };
}

async function handleTts(payload: any, key: string) {
  let text = String(payload?.text ?? payload?.q ?? payload?.arabic ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return json({ ok: false, error: 'no_text' }, 400);
  if (text.length > TTS_MAX_CHARS) text = text.slice(0, TTS_MAX_CHARS);

  const voice = String(payload?.voice || TTS_VOICE);
  const lang = String(payload?.lang || 'ar');
  const cacheKey = `${voice}|${lang}|${text}`;

  const hit = memGet(cacheKey);
  if (hit) {
    return json({ ok: true, engine: hit.engine, mime: hit.mime, bytes: hit.bytes.length, cached: true, audio: b64(hit.bytes) });
  }

  const t0 = Date.now();
  const attempts: string[] = [];

  if (key) {
    for (const model of TTS_MODELS) {
      try {
        const a = await geminiTts(model, key, text, voice);
        if (a) {
          memSet(cacheKey, a);
          return json({ ok: true, engine: a.engine, mime: a.mime, bytes: a.bytes.length, ms: Date.now() - t0, audio: b64(a.bytes) });
        }
      } catch (e) {
        attempts.push(`${model}:${clip(String(e), 120)}`);
      }
    }
  } else {
    attempts.push('no_gemini_key');
  }

  try {
    const a = await googleTranslateTts(text, lang);
    memSet(cacheKey, a);
    return json({
      ok: true, engine: a.engine, mime: a.mime, bytes: a.bytes.length, ms: Date.now() - t0,
      fallback: true, attempts, audio: b64(a.bytes)
    });
  } catch (e) {
    attempts.push(`gtts:${clip(String(e), 120)}`);
  }

  return json({ ok: false, error: 'tts_failed', detail: attempts.join(' | ').slice(0, 600) }, 502);
}

/* ================= serve ================= */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET') {
    return json({
      ok: true, fn: 'dubai-ai', model: PRIMARY_MODEL,
      modes: ['chat', 'translate', 'tts'], tts: { models: TTS_MODELS, voice: TTS_VOICE, fallback: 'google-translate-tts' },
      hint: 'POST {messages, context} | {mode:"translate",messages} | {mode:"tts",text}'
    });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const key = Deno.env.get('GEMINI_API_KEY') || '';

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const mode = String(payload?.mode || 'chat').toLowerCase();

  if (mode === 'tts') return handleTts(payload, key);

  if (!key) return json({ ok: false, error: 'missing_gemini_api_key' }, 500);

  const contents = toGeminiContents(payload.messages);
  if (!contents.length) return json({ ok: false, error: 'no_messages' }, 400);

  if (mode === 'translate') {
    const out = await runText(key, TRANSLATE_SYSTEM_PROMPT, contents, { temperature: 0.2, maxTokens: 400 });
    if (!out.ok) return json({ ok: false, error: out.error, detail: out.detail, tried: out.tried }, 502);
    return json({ ok: true, mode: 'translate', reply: out.reply, model: out.model, usage: out.usage, ms: out.ms });
  }

  const systemPrompt = buildSystemPrompt(payload.context);
  const out = await runText(key, systemPrompt, contents);
  if (!out.ok) return json({ ok: false, error: out.error, detail: out.detail, tried: out.tried }, 502);
  return json({ ok: true, reply: out.reply, model: out.model, usage: out.usage, ms: out.ms });
});
