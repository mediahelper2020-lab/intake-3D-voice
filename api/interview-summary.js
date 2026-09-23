// Vercel 서버리스 함수: AI 음성 초기면접에서 누적된 "구조화된 항목"만을 근거로
// 면접 종료 시 표시할 요약(8개 영역)을 생성한다.
// 원본 음성이나 대화 전문을 받지 않고, 클라이언트가 이미 뽑아낸 구조화 데이터만 입력으로 받는다.
import { readEnvKey } from './_voice-shared.js';

const SUMMARY_SYSTEM_PROMPT = `당신은 사회복지 초기면접 기록을 정리하는 보조 도구입니다.
입력으로 주어지는 것은 AI 음성 상담 중 이미 추출된 구조화된 항목 목록뿐입니다(원본 음성이나 대화 전문이 아닙니다).
이 정보만을 근거로 아래 8개 영역으로 요약을 작성하세요. 목록에 없는 내용을 추측하거나 지어내지 마세요.
당신은 진단, 서비스 적격 판정, 사례관리 결정을 내리지 않습니다. 그런 문구를 절대 포함하지 마세요.
각 영역은 한국어로 간결한 문장 또는 항목 나열로 작성하고, 근거가 부족하면 "확인된 내용 없음"이라고 쓰세요.
반드시 JSON으로만 응답하세요.`;

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    mainComplaint: { type: 'string', description: '주요 호소내용' },
    personalNeeds: { type: 'string', description: '개인적 욕구' },
    familyNeeds: { type: 'string', description: '가족·관계적 욕구' },
    healthNeeds: { type: 'string', description: '건강 관련 욕구' },
    communityNeeds: { type: 'string', description: '지역사회·환경적 욕구' },
    serviceNeeds: { type: 'string', description: '서비스 욕구' },
    strengths: { type: 'string', description: '이용자의 강점과 자원' },
    needsConfirmation: { type: 'string', description: '추가 확인 필요사항' },
    summary: { type: 'string', description: '상담내용 요약 (전문적 판단·서비스 결정 문구 금지)' }
  },
  required: [
    'mainComplaint',
    'personalNeeds',
    'familyNeeds',
    'healthNeeds',
    'communityNeeds',
    'serviceNeeds',
    'strengths',
    'needsConfirmation',
    'summary'
  ],
  additionalProperties: false
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
    return;
  }

  let apiKey;
  try {
    apiKey = readEnvKey();
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  const findings = Array.isArray(req.body?.findings) ? req.body.findings : null;
  if (!findings) {
    res.status(400).json({ error: 'findings 배열이 필요합니다.' });
    return;
  }

  // 방어적 재확인: 만약 findings 안에 PII로 보이는 항목이 섞여 들어왔다면 서버에서 한 번 더 걸러낸다.
  const piiPattern = /(\d{6}\s*-?\s*[1-4]\d{6}|\d{2,3}-\d{3,4}-\d{4})/;
  const safeFindings = findings
    .filter((f) => f && typeof f.value === 'string')
    .map((f) => ({
      category: String(f.category || 'other'),
      field: String(f.field || ''),
      value: piiPattern.test(f.value) ? '[비공개 처리됨]' : f.value,
      status: f.status === 'confirmed' ? 'confirmed' : 'needs_confirmation'
    }));

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(safeFindings) }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'intake_summary', schema: SUMMARY_SCHEMA, strict: true }
        }
      })
    });

    const payload = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: payload?.error?.message || '요약 생성에 실패했습니다.'
      });
      return;
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      res.status(502).json({ error: 'AI 응답에서 요약 내용을 찾을 수 없습니다.' });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      res.status(502).json({ error: '요약 결과를 해석할 수 없습니다(JSON 파싱 실패).' });
      return;
    }

    res.status(200).json({ summary: parsed });
  } catch (err) {
    res.status(500).json({ error: '요약을 생성하는 중 오류가 발생했습니다: ' + err.message });
  }
}
