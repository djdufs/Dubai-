// 두바이 출장 가이드 — "아랍맨" AI 상담 Edge Function
// GEMINI_API_KEY는 Supabase Secret에만 있고 이 코드/저장소에는 절대 넣지 않는다.
// 배포: supabase functions deploy dubai-ai --no-verify-jwt (또는 Management API)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

const PRIMARY_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

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
    '2. 필요하면 • 불릿 2~4개. 모바일이라 마크다운 표는 쓰지 않는다.',
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

async function callGemini(model: string, key: string, systemPrompt: string, contents: unknown) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.75,
      topP: 0.95,
      maxOutputTokens: 1024,
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
    body: JSON.stringify(body)
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET') {
    return json({ ok: true, fn: 'dubai-ai', model: PRIMARY_MODEL, hint: 'POST {messages, context}' });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ ok: false, error: 'missing_gemini_api_key' }, 500);

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const contents = toGeminiContents(payload.messages);
  if (!contents.length) return json({ ok: false, error: 'no_messages' }, 400);

  const systemPrompt = buildSystemPrompt(payload.context);

  const tried: string[] = [];
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
  let lastErr = '';

  for (const model of models) {
    tried.push(model);
    const t0 = Date.now();
    let res;
    try {
      res = await callGemini(model, key, systemPrompt, contents);
    } catch (e) {
      lastErr = `fetch_failed:${String(e)}`;
      continue;
    }
    const took = Date.now() - t0;

    if (res.status === 200) {
      const reply = extractText(res.data);
      if (reply) {
        return json({
          ok: true,
          reply,
          model: res.data?.modelVersion || model,
          usage: res.data?.usageMetadata || null,
          ms: took
        });
      }
      lastErr = `empty_candidate:${JSON.stringify(res.data?.candidates?.[0]?.finishReason || '')}`;
      continue;
    }

    lastErr = `http_${res.status}:${clip(res.data?.error?.message || '', 220)}`;
  }

  return json({ ok: false, error: 'upstream_failed', detail: lastErr, tried }, 502);
});
