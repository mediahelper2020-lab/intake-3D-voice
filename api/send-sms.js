// Case-IN Voice — 어르신께 사전상담 링크를 문자(SMS/LMS)로 발송하는 서버리스 함수
// 기본 구현은 국내에서 널리 쓰이는 알리고(Aligo) 문자 API를 사용한다. 다른 업체(NHN Cloud, 가비아 등)를
// 쓰신다면 이 파일의 sendViaAligo() 부분만 해당 업체 API 호출로 교체하면 된다.
//
// 필요한 환경변수 (Vercel Settings → Environment Variables):
//   ALIGO_API_KEY   - 알리고에서 발급받은 API 키
//   ALIGO_USER_ID   - 알리고 가입 아이디
//   ALIGO_SENDER    - 알리고에 사전 등록해 둔 발신번호(숫자만, 예: 0212345678)
//
// 전화번호(phone)는 문자 발송 요청 처리 중에만 사용하고 서버에 저장하지 않는다.

const ALIGO_ENDPOINT = 'https://apis.aligo.in/send/';

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

async function sendViaAligo({ phone, message }) {
  const apiKey = process.env.ALIGO_API_KEY;
  const userId = process.env.ALIGO_USER_ID;
  const sender = process.env.ALIGO_SENDER;
  if (!apiKey || !userId || !sender) {
    const err = new Error('서버에 ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER 환경변수가 설정되어 있지 않습니다.');
    err.statusCode = 500;
    throw err;
  }

  const isLong = Buffer.byteLength(message, 'utf8') > 80;
  const form = new URLSearchParams({
    key: apiKey,
    user_id: userId,
    sender,
    receiver: phone,
    msg: message,
    msg_type: isLong ? 'LMS' : 'SMS'
  });

  const upstream = await fetch(ALIGO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const payload = await upstream.json();
  // 알리고는 HTTP 200과 함께 result_code로 성공/실패를 알려준다 (1: 성공, 그 외: 실패).
  if (!upstream.ok || Number(payload.result_code) !== 1) {
    throw new Error(payload.message || '문자 발송에 실패했습니다.');
  }
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
    return;
  }

  const phone = normalizePhone(req.body?.phone);
  const link = String(req.body?.link || '');
  if (!phone || phone.length < 9) {
    res.status(400).json({ error: '올바른 휴대폰 번호를 입력해 주세요.' });
    return;
  }
  if (!link) {
    res.status(400).json({ error: 'link 값이 필요합니다.' });
    return;
  }

  const message = `[복지인사이트 Case-IN]\n안녕하세요, 방문 전에 편하게 나누는 사전 상담 링크입니다.\n아래 주소를 눌러 들어가 주세요.\n${link}`;

  try {
    await sendViaAligo({ phone, message });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message || '문자 발송 중 오류가 발생했습니다.' });
  }
}
