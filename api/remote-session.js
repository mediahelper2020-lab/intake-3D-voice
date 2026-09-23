// Case-IN Voice — 원격 사전상담(문자 링크) 세션의 임시 서버 저장소 API
// 어르신 휴대폰(pre-consult.html)과 사회복지사 브라우저(Case-IN 본앱) 사이에서
// "구조화된 결과만" 짧게 중계하는 용도이며, 음성 원본이나 대화 전문은 절대 저장하지 않는다.
import { randomUUID } from 'node:crypto';
import { kvGet, kvSet, kvDel } from './_kv.js';

const TTL_SECONDS = 60 * 60 * 24 * 3; // 3일 뒤 자동 만료 (개인정보 최소 보관)
const KEY_PREFIX = 'voice-remote:';

function keyFor(token) {
  return KEY_PREFIX + token;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const token = randomUUID();
      const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 60) : '';
      const record = { token, name, status: 'pending', createdAt: new Date().toISOString(), completedAt: null, findings: [], summary: null };
      await kvSet(keyFor(token), record, TTL_SECONDS);
      res.status(200).json({ token });
      return;
    }

    const token = (req.query && req.query.token) || '';
    if (!token) {
      res.status(400).json({ error: 'token 파라미터가 필요합니다.' });
      return;
    }

    if (req.method === 'GET') {
      const record = await kvGet(keyFor(token));
      if (!record) {
        res.status(404).json({ error: '유효하지 않거나 만료된 링크입니다.' });
        return;
      }
      res.status(200).json(record);
      return;
    }

    if (req.method === 'PATCH') {
      const record = await kvGet(keyFor(token));
      if (!record) {
        res.status(404).json({ error: '유효하지 않거나 만료된 링크입니다.' });
        return;
      }
      const findings = Array.isArray(req.body?.findings) ? req.body.findings : [];
      const summary = req.body?.summary || null;
      const updated = { ...record, status: 'completed', completedAt: new Date().toISOString(), findings, summary };
      await kvSet(keyFor(token), updated, TTL_SECONDS);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      await kvDel(keyFor(token));
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'POST, GET, PATCH, DELETE');
    res.status(405).json({ error: '지원하지 않는 메서드입니다.' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || '서버 오류가 발생했습니다.' });
  }
}
