// Case-IN Voice — 임시 서버 저장소(Key-Value) 공용 유틸
// Vercel의 예전 "KV" 상품은 단종되고 마켓플레이스의 "Upstash for Redis" 등으로 대체되었다.
// 마켓플레이스 연결 시 Custom Prefix를 지정하면 KV_REST_API_URL 같은 "빈 레거시 이름"과
// prefix_KV_REST_API_URL 같은 "실제 값이 든 이름"이 함께 생기는 경우가 있었다(값이 있는 쪽만
// 유효). 그래서 정확한 이름을 먼저 시도하고, 없거나 비어 있으면 REDIS/KV/UPSTASH 관련
// 환경변수 중 실제로 값이 채워진 것을 이름 패턴으로 찾아 사용한다. 별도 패키지 설치 없이
// Upstash REST API를 직접 호출한다. 원격 사전상담 결과처럼 "짧게 임시 보관 후 삭제"하는
// 용도로만 사용한다(개인정보 최소 보관 원칙).

function findEnv(patterns, exclude) {
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (exclude && exclude.test(key)) continue;
    if (patterns.some((p) => p.test(key))) return { key, value };
  }
  return null;
}

function resolveKvCreds() {
  let urlKey = null;
  let url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  if (url) urlKey = process.env.KV_REST_API_URL ? 'KV_REST_API_URL' : 'UPSTASH_REDIS_REST_URL';
  if (!url) {
    const found = findEnv([/KV_REST_API_URL$/i, /UPSTASH_REDIS_REST_URL$/i]);
    if (found) {
      url = found.value;
      urlKey = found.key;
    }
  }

  let tokenKey = null;
  let token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (token) tokenKey = process.env.KV_REST_API_TOKEN ? 'KV_REST_API_TOKEN' : 'UPSTASH_REDIS_REST_TOKEN';
  if (!token) {
    const found = findEnv([/KV_REST_API_TOKEN$/i, /UPSTASH_REDIS_REST_TOKEN$/i], /READ_ONLY/i);
    if (found) {
      token = found.value;
      tokenKey = found.key;
    }
  }

  return { url, token, urlKey, tokenKey };
}

// 진단용: 실제 값은 절대 반환하지 않고, 어떤 환경변수 "이름"을 골랐는지만 알려준다.
export function describeKvSource() {
  const { url, token, urlKey, tokenKey } = resolveKvCreds();
  return { urlKey: url ? urlKey : null, tokenKey: token ? tokenKey : null };
}

function kvConfig() {
  const { url, token } = resolveKvCreds();
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
