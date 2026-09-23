// Case-IN Voice — 원격 사전상담(문자 링크로 접속하는 어르신용 독립 페이지) 컨트롤러
// Case-IN 본앱과는 별개의 페이지이며, IndexedDB나 current 같은 본앱 전역을 전혀 사용하지 않는다.
// 오직 /api/remote-session (임시 서버 저장소)에만 "구조화된 결과"를 전달한다.
(function () {
  'use strict';

  const root = () => document.getElementById('rcRoot');
  const MAX_CALL_MS = 5 * 60 * 1000; // 통화 최대 길이
  const WRAPUP_AT_MS = 4 * 60 * 1000; // 이 시점에 AI가 스스로 마무리를 시작하도록 안내
  const WRAPUP_NUDGE =
    '지금까지 대화를 잘 나누셨습니다. 이제 새로운 주제를 새로 꺼내지 말고, 1분 안에 자연스럽게 대화를 마무리해주세요. 오늘 나눠주신 이야기에 짧게 감사 인사를 전하고, 담당 선생님께 잘 전달하겠다고 안내하며 대화를 끝내주세요.';

  // 어르신 화면에는 구체적인 대화 내용(예: 허리 통증, 당뇨 등) 대신 어떤 주제를 나눴는지만
  // 친근하게 보여준다. 실제 상세 내용은 findings 배열에 그대로 담겨 사회복지사에게 전달된다.
  const FRIENDLY_TOPIC_LABELS = {
    livingStatus: '🏠 생활 이야기',
    family: '👨‍👩‍👧 가족 이야기',
    economy: '💰 생활형편 이야기',
    health: '💛 건강 이야기',
    disability: '💛 건강 이야기',
    emotional: '😊 마음 이야기',
    socialRelation: '🤝 이웃 이야기',
    serviceUsage: '🛎 이용 서비스 이야기',
    difficulty: '💭 요즘 어려움 이야기',
    desiredSupport: '🙏 바라시는 도움 이야기',
    strength: '🌟 좋은 점 이야기',
    other: '💬 그 밖의 이야기'
  };

  let token = '';
  let client = null;
  let avatar = null;
  let findings = [];
  let currentCaption = '';
  let ended = false;
  let greetingSent = false;
  let wrapupTimer = null;
  let hardCutoffTimer = null;

  function clearCallTimers() {
    if (wrapupTimer) {
      clearTimeout(wrapupTimer);
      wrapupTimer = null;
    }
    if (hardCutoffTimer) {
      clearTimeout(hardCutoffTimer);
      hardCutoffTimer = null;
    }
  }

  function getToken() {
    const params = new URLSearchParams(location.search);
    return params.get('t') || '';
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderInvalid(message) {
    root().innerHTML = `
      <h1>링크를 열 수 없습니다</h1>
      <p>${esc(message)}</p>
      <p>담당 선생님께 링크를 다시 요청해 주세요.</p>`;
  }

  function renderAlreadyDone() {
    root().innerHTML = `
      <h1>이미 완료된 상담입니다</h1>
      <p>소중한 말씀 감사합니다. 담당 선생님께 이미 전달되었습니다.</p>
      <p>이 화면은 이제 닫으셔도 됩니다.</p>`;
  }

  function renderConsent() {
    root().innerHTML = `
      <h1>편하게 몇 가지 이야기를 나눌게요</h1>
      <p>담당 선생님이 찾아뵙기 전에, 요즘 어떻게 지내시는지 미리 여쭤보려고 합니다.</p>
      <div class="rc-notice">
        · 주민등록번호, 주소, 전화번호 같은 것은 묻지 않습니다.<br>
        · 하신 말씀 중 필요한 내용만 정리해서 담당 선생님께 전달됩니다.<br>
        · 목소리 자체는 저장되지 않습니다.<br>
        · 언제든 <b>[상담 마치기]</b> 버튼을 눌러 그만하실 수 있습니다.
      </div>
      <button type="button" class="rc-btn rc-btn-primary" id="rcStart">시작하기</button>`;
    document.getElementById('rcStart').onclick = startSession;
  }

  function renderActive() {
    root().innerHTML = `
      <div class="rc-avatar-area" id="rcAvatarArea"></div>
      <div class="rc-findings" id="rcFindingsWrap">
        <h3>지금까지 나눈 이야기</h3>
        <div id="rcFindingsList" class="rc-topics"><p class="voice-empty">아직 없습니다.</p></div>
      </div>
      <button type="button" class="rc-btn rc-btn-secondary" id="rcEnd">상담 마치기</button>`;
    avatar = window.AvatarAdapter.create(document.getElementById('rcAvatarArea'));
    document.getElementById('rcEnd').onclick = () => finishSession('completed');
  }

  // 구체적인 답변 내용이 아니라 "어떤 주제로 이야기를 나눴는지"만 어르신께 보여준다.
  function renderFindings() {
    const el = document.getElementById('rcFindingsList');
    if (!el) return;
    const seen = new Set();
    const topics = [];
    findings.forEach((f) => {
      if (f.category === 'followUp') return; // 직원 확인용 메모는 어르신 화면에 노출하지 않는다
      const label = FRIENDLY_TOPIC_LABELS[f.category] || FRIENDLY_TOPIC_LABELS.other;
      if (!seen.has(label)) {
        seen.add(label);
        topics.push(label);
      }
    });
    if (!topics.length) {
      el.innerHTML = '<p class="voice-empty">아직 없습니다.</p>';
      return;
    }
    el.innerHTML = topics.map((t) => `<span class="rc-topic-chip">${esc(t)}</span>`).join('');
  }

  function applyUpdates(updates) {
    updates.forEach((u) => {
      if (!u || !u.value) return;
      findings.push({
        category: u.category || 'other',
        field: u.field || u.category || '확인된 내용',
        value: String(u.value),
        status: u.status === 'confirmed' ? 'confirmed' : 'needs_confirmation'
      });
    });
    renderFindings();
  }

  function handleFunctionCall(evt) {
    if (evt.name !== 'record_intake_findings') return;
    let args = null;
    try {
      args = JSON.parse(evt.arguments || '{}');
    } catch {
      args = null;
    }
    if (args && Array.isArray(args.updates)) applyUpdates(args.updates);
    client.sendEvent({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: evt.call_id, output: JSON.stringify({ ok: true }) }
    });
    client.sendEvent({ type: 'response.create' });
  }

  function handleRealtimeEvent(evt) {
    switch (evt.type) {
      case 'input_audio_buffer.speech_started':
        avatar && avatar.setListening(true);
        break;
      case 'response.created':
        avatar && avatar.setThinking(true);
        currentCaption = '';
        break;
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
        currentCaption += evt.delta || '';
        avatar && avatar.setSpeaking(true, currentCaption);
        break;
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
        currentCaption = '';
        break;
      case 'response.function_call_arguments.done':
        handleFunctionCall(evt);
        break;
      case 'error':
        renderConnectError(evt.error?.message || 'AI 응답 중 문제가 발생했습니다.');
        break;
      default:
        break;
    }
  }

  async function startSession() {
    renderActive();
    avatar.setThinking(false);
    greetingSent = false;
    client = new window.RealtimeVoiceClient({
      onEvent: handleRealtimeEvent,
      onConnectionState: (state) => {
        if (state === 'connected' && !greetingSent) {
          greetingSent = true;
          avatar && avatar.setThinking(true);
          client.sendEvent({ type: 'response.create' });
          clearCallTimers();
          wrapupTimer = setTimeout(() => {
            if (client) client.sendEvent({ type: 'response.create', response: { instructions: WRAPUP_NUDGE } });
          }, WRAPUP_AT_MS);
          hardCutoffTimer = setTimeout(() => {
            finishSession('completed');
          }, MAX_CALL_MS);
        }
      }
    });
    try {
      await client.connect();
    } catch (err) {
      renderConnectError(String(err && err.message ? err.message : err));
    }
  }

  function renderConnectError(message) {
    const guide = /Permission denied|NotAllowedError|마이크/.test(message)
      ? '마이크 사용을 허용해 주셔야 대화할 수 있어요. 브라우저 설정에서 마이크 권한을 허용한 뒤 이 링크를 다시 눌러 주세요.'
      : '인터넷 연결을 확인하시고 이 링크를 다시 눌러 주세요.';
    root().innerHTML = `
      <h1>연결에 문제가 있어요</h1>
      <p>${esc(message)}</p>
      <p>${esc(guide)}</p>
      ${findings.length ? '<p>지금까지 나눈 이야기는 안전하게 전달해 드릴게요.</p>' : ''}
      <button type="button" class="rc-btn rc-btn-secondary" id="rcRetry">다시 시도</button>`;
    document.getElementById('rcRetry').onclick = () => finishSession('error');
  }

  async function finishSession(reason) {
    if (ended) return;
    ended = true;
    clearCallTimers();
    if (client) {
      client.disconnect();
      client = null;
    }
    root().innerHTML = '<div class="rc-loading">말씀해 주셔서 감사합니다. 마무리하는 중입니다…</div>';

    let summary = null;
    if (findings.length) {
      try {
        const res = await fetch('/api/interview-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ findings })
        });
        const payload = await res.json();
        if (res.ok) summary = payload.summary;
      } catch {
        // 요약 생성이 실패해도 구조화된 항목은 그대로 전달한다.
      }
    }

    try {
      await fetch(`/api/remote-session?token=${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findings, summary })
      });
    } catch {
      // 전송 실패 시에도 어르신께는 감사 인사만 보여준다. 담당자가 재발송을 안내한다.
    }

    root().innerHTML = `
      <h1>감사합니다</h1>
      <p>오늘 말씀해 주신 내용은 담당 선생님께 전달됩니다.</p>
      <p>다음에 뵐 때 더 편하게 이야기 나누실 수 있을 거예요.</p>
      <p>이 화면은 이제 닫으셔도 됩니다.</p>`;
  }

  window.startRemoteConsult = async function () {
    token = getToken();
    if (!token) {
      renderInvalid('링크에 필요한 정보가 없습니다.');
      return;
    }
    try {
      const res = await fetch(`/api/remote-session?token=${encodeURIComponent(token)}`);
      const record = await res.json();
      if (!res.ok) {
        renderInvalid(record.error || '유효하지 않거나 만료된 링크입니다.');
        return;
      }
      if (record.status === 'completed') {
        renderAlreadyDone();
        return;
      }
      renderConsent();
    } catch {
      renderInvalid('네트워크 연결을 확인해 주세요.');
    }
  };
})();
