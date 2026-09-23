// Vercel 서버리스 함수: OpenAI Realtime API용 단명(ephemeral) 클라이언트 시크릿 발급
// OPENAI_API_KEY는 절대 브라우저로 전달하지 않는다. 이 함수가 반환하는 것은
// 짧은 시간만 유효한 client_secret 뿐이며, 이것으로 브라우저가 직접 OpenAI와 WebRTC 연결을 맺는다.
import { REALTIME_MODEL, SYSTEM_INSTRUCTIONS, RECORD_TOOL, TIP_TOOL, readEnvKey } from './_voice-shared.js';

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

  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions: SYSTEM_INSTRUCTIONS,
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: { type: 'server_vad' }
            },
            output: {
              voice: 'alloy'
            }
          },
          tools: [RECORD_TOOL, TIP_TOOL],
          tool_choice: 'auto'
        }
      })
    });

    const payload = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: payload?.error?.message || 'OpenAI Realtime 세션 생성에 실패했습니다.'
      });
      return;
    }

    const clientSecret = payload.value || payload.client_secret?.value;
    if (!clientSecret) {
      res.status(502).json({ error: 'OpenAI 응답에서 client_secret 값을 찾을 수 없습니다.' });
      return;
    }

    res.status(200).json({
      clientSecret,
      model: REALTIME_MODEL,
      expiresAt: payload.expires_at || null
    });
  } catch (err) {
    res.status(500).json({ error: '음성 세션을 생성하는 중 오류가 발생했습니다: ' + err.message });
  }
}
