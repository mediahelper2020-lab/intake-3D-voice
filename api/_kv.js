// Case-IN Voice — 임시 서버 저장소(Key-Value) 공용 유틸
// Vercel의 예전 "KV" 상품은 단종되고 마켓플레이스의 "Upstash for Redis" 등으로 대체되었다.
// 어떤 이름으로 연결하든 실제로는 Upstash REST API이므로, 아래 두 가지 환경변수 이름을
// 모두 지원한다: KV_REST_API_URL/TOKEN(레거시 호환 이름) 또는 UPSTASH_REDIS_REST_URL/TOKEN(신규 이름).
// 별도 패키지 설치 없이 Upstash REST API를 직접 호출한다.
// 원격 사전상담 결과처럼 "짧게 임시 보관 후 삭제"하는 용도로만 사용한다(개인정보 최소 보관 원칙).

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    const err = new Error(
      '서버에 Redis(KV) 접속 환경변수가 설정되어 있지 않습니다. Vercel Storage에서 "Upstash for Redis"(또는 Upstash) 스토리지를 만들어 이 프로젝트에 연결해 주세요.'
    );
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
