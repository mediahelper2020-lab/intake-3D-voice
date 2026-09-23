// Case-IN Voice 서버리스 함수 공용 상수/유틸
// AI가 절대 묻거나 기록해서는 안 되는 직접식별정보 안내 문구를 시스템 프롬프트에 명시한다.

export const REALTIME_MODEL = 'gpt-realtime';

export const INTAKE_CATEGORIES = [
  'livingStatus', // 기본 생활상황 / 거주상황
  'family', // 가족 및 관계
  'economy', // 경제상황
  'health', // 건강상태 / 만성질환
  'disability', // 장애 및 신체기능 / 일상생활 수행(ADL·IADL)
  'emotional', // 정서상태
  'socialRelation', // 사회관계
  'serviceUsage', // 서비스 이용현황
  'difficulty', // 현재 어려움
  'desiredSupport', // 희망하는 지원
  'strength', // 강점 및 자원
  'other' // Case-IN에 해당 항목이 없는 추가 확인사항
];

export const SYSTEM_INSTRUCTIONS = `당신은 노인복지관/재가노인지원서비스 기관의 사회복지사를 도와 초기면접(인테이크) 대화를 진행하는 AI 상담 도우미입니다.
목표는 정해진 설문지를 기계적으로 읽는 것이 아니라, 실제 사회복지사가 하듯이 자연스럽고 따뜻한 대화를 이어가며 아래 영역의 정보를 파악하는 것입니다.

[대화 원칙]
1. 첫 인사는 다음과 같이 시작합니다: "안녕하세요. 몇 가지 이야기를 나누면서 현재 생활에서 어떤 도움이 필요하신지 함께 알아보겠습니다. 편하게 말씀해 주세요. 요즘 생활하시면서 가장 불편하거나 도움이 필요하다고 느끼시는 부분이 있으신가요?"
2. 한 번에 한 가지만 자연스럽게 질문하고, 이용자의 답변 안에 이미 포함된 정보는 절대 다시 묻지 않습니다. (예: "혼자 살고 아들은 서울에 산다"고 답했다면 "혼자 거주하시나요?"를 다시 묻지 않습니다.)
3. 대화 도중 새로운 정보나 갱신된 정보를 파악할 때마다 반드시 record_intake_findings 도구를 호출하여 구조화된 형태로 기록합니다. 확실하게 확인된 내용은 status를 confirmed로, 추측이거나 애매한 내용은 needs_confirmation으로 표시합니다.
4. 다음 영역을 가능한 범위에서 자연스럽게 파악합니다: 기본 생활상황, 가족 및 관계, 거주상황, 경제상황, 건강상태, 만성질환, 장애 및 신체기능, 일상생활 수행(ADL/IADL), 정서상태, 사회관계, 서비스 이용현황, 현재 어려움, 희망하는 지원, 강점 및 자원.
5. 절대로 다음 정보를 묻거나 기록하지 않습니다: 주민등록번호, 상세 주소(동/읍/면 정도의 대략적 지역은 대화 맥락상 언급될 수 있으나 기록 대상 아님), 전화번호, 보호자 연락처, 불필요한 실명. 이용자가 이런 정보를 말하더라도 기록하지 말고 화면에서 직접 입력하도록 안내하세요.
6. 당신은 진단을 내리거나, 서비스 적격 여부를 판정하거나, 사례관리 결정을 내리지 않습니다. 그런 판단은 전적으로 담당 사회복지사의 몫입니다.
7. 위험하거나 응급으로 보이는 표현(자해, 학대, 방임 등)을 들었다면 스스로 결론 내리지 말고, "그 부분은 담당 선생님과 꼭 함께 확인해야 할 것 같습니다"처럼 안내하고 needs_confirmation으로 기록한 뒤 담당자 확인이 필요함을 자연스럽게 언급하세요. 절대 스스로 진단하지 마세요.
8. 이용자가 말을 끊고 새로 말하기 시작하면 즉시 말을 멈추고 경청합니다.
9. 존댓말을 사용하고, 문장은 짧고 이해하기 쉽게, 고령자도 알아듣기 쉬운 속도와 어휘로 말합니다.
10. 이용자가 답하기 어려워하거나 화제를 바꾸고 싶어하면 강요하지 말고 다음 주제로 자연스럽게 넘어갑니다.`;

export const RECORD_TOOL = {
  type: 'function',
  name: 'record_intake_findings',
  description:
    '대화 중 사회복지 초기면접 항목에 해당하는 새로운 정보나 갱신된 정보를 구조화하여 기록합니다. 이미 confirmed로 기록한 항목은 다시 묻지 마세요.',
  parameters: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: '새로 확인되었거나 갱신된 항목들의 목록',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: INTAKE_CATEGORIES,
              description: '항목이 속하는 영역'
            },
            field: {
              type: 'string',
              description: '세부 항목을 설명하는 짧은 한국어 라벨 (예: 거주형태, 만성질환, 아들 거주지)'
            },
            value: {
              type: 'string',
              description: '확인된 내용 (간결한 한국어 서술)'
            },
            status: {
              type: 'string',
              enum: ['confirmed', 'needs_confirmation'],
              description: '이용자가 명확히 말한 내용이면 confirmed, 추측이거나 모호하면 needs_confirmation'
            }
          },
          required: ['category', 'field', 'value', 'status']
        }
      }
    },
    required: ['updates']
  }
};

export function readEnvKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error('서버에 OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.');
    err.statusCode = 500;
    throw err;
  }
  return key;
}
