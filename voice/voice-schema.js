// Case-IN Voice — 기존 Case-IN 초기면접지(index.html의 intake() 함수) 필드와
// AI가 대화 중 추출한 구조화 데이터를 연결하는 매핑 테이블.
// 여기서 정의한 옵션 문자열은 index.html의 실제 select/checkbox 옵션과 정확히 일치해야
// "정확히 일치하는 경우에만 반영한다"는 원칙이 지켜진다.
//
// 이 파일은 classic <script> 로 로드되어 전역 CaseInVoiceSchema 로 노출된다 (모듈 X).
// 기존 index.html 스크립트를 전혀 수정하지 않고 같은 전역(let current 등)을 그대로 읽고 쓴다.
(function () {
  'use strict';

  // index.html intake() 안의 실제 옵션과 동일 — 문자열이 달라지면 이 배열도 함께 갱신해야 한다.
  const FIELD_DEFS = {
    living: { kind: 'single', options: ['독거노인', '노인 2인가구', '기타'], label: '동거실태' },
    housing: {
      kind: 'single',
      options: ['자가', '전세', '월세', '임대아파트', '의탁거주/무료임대', '기타'],
      label: '주거형태'
    },
    housingType: {
      kind: 'single',
      options: ['단독주택', '아파트', '빌라/연립', '다세대주택', '기타'],
      label: '주택 종류'
    },
    heating: { kind: 'single', options: ['연탄(구공탄)', '기름', '가스', '기타'], label: '난방종류' },
    economy: { kind: 'single', options: ['국민기초생활수급권자', '차상위', '일반', '기타'], label: '경제상황' },
    health: {
      kind: 'single',
      options: [
        '건강하다',
        '질환은 있지만 건강한 편이다',
        '특별한 질환은 없지만 노환으로 건강하지 못하다',
        '질환으로 건강이 나쁘다'
      ],
      label: '건강상태'
    },
    disease: {
      kind: 'multi',
      options: ['고혈압', '당뇨병', '심장병', '관절염', '만성폐질환', '만성 위장병', '골다공증', '암질환', '뇌졸중', '기타'],
      label: '만성질환'
    },
    disability: { kind: 'multi', options: ['시각', '청각', '언어', '신체', '정서', '기타'], label: '장애상태' },
    aid: { kind: 'multi', options: ['휠체어', '지팡이', '목발', '보청기', '틀니', '기타'], label: '보장구' },
    services: { kind: 'multi', options: ['경제지원', '일상생활지원', '정서지원', '기타사업'], label: '희망 서비스' }
  };

  // 대화 카테고리 → 매핑을 시도할 Case-IN 필드 후보
  const CATEGORY_TO_FIELDS = {
    livingStatus: ['living', 'housing', 'housingType', 'heating'],
    economy: ['economy'],
    health: ['health', 'disease'],
    disability: ['disability', 'aid'],
    serviceUsage: ['services']
  };

  // 값(자연어) → 정확한 옵션 문자열 매칭을 돕는 키워드 사전. 사전에 없으면 매핑하지 않고
  // "추가 확인사항"으로 분류한다 (임의 추측 금지 원칙).
  const KEYWORD_TO_OPTION = {
    living: [
      [/독거|혼자\s*(살|거주|지내)/, '독거노인'],
      [/노인\s*2인|부부만|둘이\s*거주/, '노인 2인가구']
    ],
    housing: [
      [/자가|본인\s*소유/, '자가'],
      [/전세/, '전세'],
      [/월세/, '월세'],
      [/임대아파트|영구임대|국민임대/, '임대아파트'],
      [/무료임대|의탁/, '의탁거주/무료임대']
    ],
    housingType: [
      [/단독주택/, '단독주택'],
      [/아파트/, '아파트'],
      [/빌라|연립/, '빌라/연립'],
      [/다세대/, '다세대주택']
    ],
    heating: [
      [/연탄/, '연탄(구공탄)'],
      [/기름|등유/, '기름'],
      [/가스/, '가스']
    ],
    economy: [
      [/기초생활수급|수급자/, '국민기초생활수급권자'],
      [/차상위/, '차상위'],
      [/일반\s*(가구|형편)/, '일반']
    ],
    health: [
      [/건강한\s*편|괜찮/, '질환은 있지만 건강한 편이다'],
      [/노환|나이가\s*들어서/, '특별한 질환은 없지만 노환으로 건강하지 못하다'],
      [/건강이\s*나쁘|많이\s*아프/, '질환으로 건강이 나쁘다'],
      [/건강하다|건강해요/, '건강하다']
    ]
  };

  const DISEASE_KEYWORDS = [
    [/고혈압/, '고혈압'],
    [/당뇨/, '당뇨병'],
    [/심장/, '심장병'],
    [/관절염|관절이\s*아프/, '관절염'],
    [/폐질환|천식|기관지/, '만성폐질환'],
    [/위장|소화기/, '만성 위장병'],
    [/골다공증/, '골다공증'],
    [/암\b/, '암질환'],
    [/뇌졸중|중풍/, '뇌졸중']
  ];

  const DISABILITY_KEYWORDS = [
    [/시각|눈이\s*안\s*보/, '시각'],
    [/청각|귀가\s*안\s*들|난청/, '청각'],
    [/언어장애|말을\s*잘\s*못/, '언어'],
    [/지체|신체\s*장애|다리를\s*못/, '신체'],
    [/정서\s*장애/, '정서']
  ];

  const AID_KEYWORDS = [
    [/휠체어/, '휠체어'],
    [/지팡이/, '지팡이'],
    [/목발/, '목발'],
    [/보청기/, '보청기'],
    [/틀니/, '틀니']
  ];

  const SERVICE_KEYWORDS = [
    [/경제\s*지원|생계비|후원/, '경제지원'],
    [/일상\s*생활\s*지원|가사|돌봄/, '일상생활지원'],
    [/정서\s*지원|말벗|정서적/, '정서지원']
  ];

  const MULTI_KEYWORDS = { disease: DISEASE_KEYWORDS, disability: DISABILITY_KEYWORDS, aid: AID_KEYWORDS, services: SERVICE_KEYWORDS };

  // AI에게 절대 보내거나 자동 반영해서는 안 되는 직접식별정보 키
  const PII_FIELD_KEYS = ['rrn', 'address', 'dong', 'phone', 'referrerPhone', 'referrer'];

  const CATEGORY_LABELS = {
    livingStatus: '기본 생활상황 / 거주상황',
    family: '가족 및 관계',
    economy: '경제상황',
    health: '건강상태 / 만성질환',
    disability: '장애 및 신체기능 / 일상생활 수행',
    emotional: '정서상태',
    socialRelation: '사회관계',
    serviceUsage: '서비스 이용현황',
    difficulty: '현재 어려움',
    desiredSupport: '희망하는 지원',
    strength: '강점 및 자원',
    other: '추가 확인사항'
  };

  function tryMatchSingle(fieldKey, value) {
    const def = FIELD_DEFS[fieldKey];
    if (!def) return null;
    if (def.options.includes(value)) return value;
    const rules = KEYWORD_TO_OPTION[fieldKey] || [];
    for (const [re, option] of rules) {
      if (re.test(value)) return option;
    }
    return null;
  }

  function tryMatchMulti(fieldKey, value) {
    const rules = MULTI_KEYWORDS[fieldKey] || [];
    const hits = [];
    for (const [re, option] of rules) {
      if (re.test(value)) hits.push(option);
    }
    return hits;
  }

  // 하나의 {category, field, value, status} 항목을 Case-IN 필드 매핑 후보로 변환.
  // 정확히 매칭되지 않으면 null을 반환하여 "추가 확인사항"으로 넘어가게 한다.
  function mapFinding(finding) {
    const candidateKeys = CATEGORY_TO_FIELDS[finding.category] || [];
    for (const key of candidateKeys) {
      const def = FIELD_DEFS[key];
      if (!def) continue;
      if (def.kind === 'single') {
        const matched = tryMatchSingle(key, finding.value);
        if (matched) {
          return { fieldKey: key, kind: 'single', label: def.label, matchedOption: matched };
        }
      } else if (def.kind === 'multi') {
        const matched = tryMatchMulti(key, finding.value);
        if (matched.length) {
          return { fieldKey: key, kind: 'multi', label: def.label, matchedOptions: matched };
        }
      }
    }
    return null;
  }

  // scoring[] (선정기준표) 옵션과 정확히 일치하는 경우에만 s{i} 값을 채울 후보를 만든다.
  // scoring은 index.html 전역에 이미 선언되어 있다 (const scoring=[...]).
  function matchScoringCandidates(findings) {
    if (typeof scoring === 'undefined') return [];
    const results = [];
    findings.forEach((f) => {
      scoring.forEach(([domain, label, opts], i) => {
        opts.forEach(([optionText]) => {
          if (f.value === optionText || (typeof f.value === 'string' && f.value.includes(optionText))) {
            results.push({ scoringIndex: i, domain, label, optionText, sourceField: f.field });
          }
        });
      });
    });
    return results;
  }

  window.CaseInVoiceSchema = {
    FIELD_DEFS,
    PII_FIELD_KEYS,
    CATEGORY_LABELS,
    mapFinding,
    matchScoringCandidates
  };
})();
