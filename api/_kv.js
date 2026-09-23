// Case-IN Voice — 임시 서버 저장소(Key-Value) 공용 유틸
// Vercel 프로젝트에 KV(Upstash Redis 기반) 스토리지를 연결하면 KV_REST_API_URL / KV_REST_API_TOKEN
// 환경변수가 자동으로 주입된다. 여기서는 별도 패키지 설치 없이 Upstash REST API를 직접 호출한다.
// 원격 사전상담 결과처럼 "짧게 임시 보관 후 삭제"하는 용도로만 사용한다(개인정보 최소 보관 원칙).

function kvConfig() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    const err = new Error('서버에 KV_REST_API_URL / KV_REST_API_TOKEN 환경변수가 설정되어 있지 않습니다. Vercel 프로젝트에 KV 스토리지를 연결해 주세요.');
    err.statusCode = 500;
    throw err;
  }
  return { url, token };
}

async function kvCommand(command) {
  const { url, token } = kvConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const payload = await res.json();
  if (!res.ok || payload.error) {
    throw new Error(payload.error || 'KV 저장소 호출에 실패했습니다.');
  }
  return payload.result;
}

// value는 JSON 직렬화하여 저장한다. ttlSeconds가 있으면 그 시간 뒤 자동 삭제된다.
export async function kvSet(key, value, ttlSeconds) {
  const serialized = JSON.stringify(value);
  const command = ttlSeconds ? ['SET', key, serialized, 'EX', String(ttlSeconds)] : ['SET', key, serialized];
  await kvCommand(command);
}

export async function kvGet(key) {
  const result = await kvCommand(['GET', key]);
  if (result === null || result === undefined) return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

export async function kvDel(key) {
  await kvCommand(['DEL', key]);
}
