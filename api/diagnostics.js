// Case-IN Voice — 환경변수 진단용 엔드포인트
// 실제 값은 절대 노출하지 않고, 각 환경변수가 "설정되어 있는지 + 글자 수"만 보여준다.
// 배포 후 이 주소를 브라우저로 직접 열어보면(GET) 어떤 값이 비어있는지 바로 확인할 수 있다.
// 예: https://내도메인/api/diagnostics
import { describeKvSource } from './_kv.js';

const CHECK_KEYS = [
  'OPENAI_API_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN'
];

export default function handler(req, res) {
  const report = {};
  for (const key of CHECK_KEYS) {
    const value = process.env[key];
    report[key] = {
      present: typeof value === 'string' && value.length > 0,
      length: typeof value === 'string' ? value.length : 0
    };
  }
  // 예상한 이름과 다르게 들어와 있을 가능성에 대비해, REDIS/KV/UPSTASH가 들어간
  // 환경변수 "이름"만 전부 나열한다 (값은 절대 포함하지 않는다).
  report._relatedKeyNamesFound = Object.keys(process.env).filter((k) => /REDIS|KV|UPSTASH/i.test(k));
  report._kvWouldUse = describeKvSource();
  report._deployedAt = new Date().toISOString();
  report._note = 'present/length만 표시하며 실제 값은 절대 포함하지 않습니다.';
  res.status(200).json(report);
}
