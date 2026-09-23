// Case-IN Voice — 메인 컨트롤러
// index.html의 기존 전역(let current, function saveCase/renderEditor/refreshScores/reload/id 등)을
// classic script 공유 스코프를 통해 그대로 재사용한다. 기존 코드는 전혀 수정하지 않는다.
(function () {
  'use strict';

  const CONSENT_KEY = 'caseInVoiceConsentAcknowledged';
  const PENDING_LINKS_KEY = 'caseInVoicePendingLinks';

  let overlayEl = null;
  let client = null;
  let avatar = null;
  let mode = 'new'; // 'new' | 'existing'
  let sessionActive = false;
  let paused = false;
  let findings = []; // {category, field, value, status, ts}
  let tips = []; // {topic, tip} — 어르신께 보여준 일반 생활정보 (화면 표시용, 서버 저장 안 함)
  let currentCaption = '';
  let summaryResult = null;
  let remoteToken = null;
  let remotePollTimer = null;
  let greetingSent = false; // AI가 연결 직후 먼저 인사를 건네도록 한 번만 트리거
  let wrapupTimer = null;
  let hardCutoffTimer = null;
  const MAX_CALL_MS = 5 * 60 * 1000; // 통화 최대 길이
  const WRAPUP_AT_MS = 4 * 60 * 1000; // 이 시점에 AI가 스스로 마무리를 시작하도록 안내
  const WRAPUP_NUDGE =
    '지금까지 대화를 잘 나누셨습니다. 이제 새로운 주제를 새로 꺼내지 말고, 1분 안에 자연스럽게 대화를 마무리해주세요. 오늘 나눠주신 이야기에 짧게 감사 인사를 전하고, 담당 선생님께 잘 전달하겠다고 안내하며 대화를 끝내주세요.';

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
  let pendingElderName = ''; // 시작 전 등록한 어르신 성함 (AI에게는 전달하지 않고, 사례 이름 등록용으로만 사용)
  let targetCaseId = null; // 원격 링크가 기존에 열려 있던 특정 사례용으로 만들어진 경우 그 사례 id

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 대기 중인 원격 사전상담 링크 (localStorage) ----------
  function getPendingLinks() {
    try {
      return JSON.parse(localStorage.getItem(PENDING_LINKS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function savePendingLinks(list) {
    try {
      localStorage.setItem(PENDING_LINKS_KEY, JSON.stringify(list));
    } catch {}
  }

  function addPendingLink(entry) {
    const list = getPendingLinks();
    list.unshift(entry);
    savePendingLinks(list);
    renderPendingConsultList();
  }

  function removePendingLink(token) {
    savePendingLinks(getPendingLinks().filter((e) => e.token !== token));
    renderPendingConsultList();
  }

  function updatePendingLinkStatus(token, status) {
    const list = getPendingLinks();
    const entry = list.find((e) => e.token === token);
    if (entry) {
      entry.status = status;
      savePendingLinks(list);
    }
  }

  function renderPendingConsultList() {
    const panel = document.querySelector('#pendingConsultPanel');
    const listEl = document.querySelector('#pendingConsultList');
    if (!panel || !listEl) return;
    const list = getPendingLinks();
    if (!list.length) {
      panel.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }
    panel.classList.remove('hidden');
    listEl.innerHTML = list
      .map((e) => {
        const statusLabel = e.status === 'completed' ? '검토 필요' : '응답 대기 중';
        const statusColor = e.status === 'completed' ? 'color:#0e8e85;font-weight:800' : 'color:#8a9aa1';
        const when = new Date(e.createdAt).toLocaleString('ko-KR');
        return `<div class="case" data-pending-row="${esc(e.token)}">
          <div><strong>${esc(e.name || '이름 미등록')}</strong> <small style="${statusColor}"> · ${statusLabel}</small><br><small>${esc(when)} 생성</small></div>
          <div class="actions">
            <button class="btn" data-pending-open="${esc(e.token)}">열기</button>
            <button class="btn danger" data-pending-remove="${esc(e.token)}">삭제</button>
          </div>
        </div>`;
      })
      .join('');
    listEl.querySelectorAll('[data-pending-open]').forEach((b) => {
      b.onclick = () => openPendingConsult(b.dataset.pendingOpen);
    });
    listEl.querySelectorAll('[data-pending-remove]').forEach((b) => {
      b.onclick = () => {
        if (!confirm('이 사전상담 대기 항목을 삭제할까요? 어르신이 이미 응답했다면 그 내용도 함께 삭제됩니다.')) return;
        const token = b.dataset.pendingRemove;
        fetch(`/api/remote-session?token=${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
        removePendingLink(token);
      };
    });
  }

  async function refreshAllPendingStatuses() {
    const list = getPendingLinks();
    await Promise.all(
      list.map(async (e) => {
        try {
          const res = await fetch(`/api/remote-session?token=${encodeURIComponent(e.token)}`);
          if (!res.ok) return;
          const record = await res.json();
          updatePendingLinkStatus(e.token, record.status);
        } catch {
          /* 네트워크 오류 시 이 항목은 건너뛰고 다음 항목을 계속 확인한다 */
        }
      })
    );
    renderPendingConsultList();
  }

  async function openPendingConsult(token) {
    const list = getPendingLinks();
    const entry = list.find((e) => e.token === token);
    if (!entry) return;
    try {
      const res = await fetch(`/api/remote-session?token=${encodeURIComponent(token)}`);
      const record = await res.json();
      if (!res.ok) {
        alert(record.error || '조회에 실패했습니다.');
        return;
      }
      remoteToken = token;
      targetCaseId = entry.caseId || null;
      pendingElderName = record.name || entry.name || '';
      overlayEl = buildShell();
      if (record.status === 'completed') {
        updatePendingLinkStatus(token, 'completed');
        findings = Array.isArray(record.findings) ? record.findings : [];
        summaryResult = record.summary || null;
        mode = targetCaseId && typeof records !== 'undefined' && records.some((r) => r.id === targetCaseId) ? 'existing' : 'new';
        renderReviewScreen(summaryResult);
      } else {
        mode = 'new';
        const link = `${location.origin}/pre-consult.html?t=${encodeURIComponent(token)}`;
        renderRemoteWaiting(link);
      }
    } catch (err) {
      alert('불러오는 중 오류가 발생했습니다: ' + err.message);
    }
  }

  function closeOverlay() {
    clearCallTimers();
    if (client) {
      client.disconnect();
      client = null;
    }
    if (remotePollTimer) {
      clearInterval(remotePollTimer);
      remotePollTimer = null;
    }
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    sessionActive = false;
    paused = false;
    findings = [];
    tips = [];
    summaryResult = null;
    remoteToken = null;
    pendingElderName = '';
    targetCaseId = null;
    greetingSent = false;
  }

  function buildShell() {
    const el = document.createElement('div');
    el.id = 'voiceOverlay';
    el.className = 'voice-overlay';
    el.innerHTML = `
      <div class="voice-modal" role="dialog" aria-modal="true" aria-label="Case-IN Voice AI 사전 상담">
        <div class="voice-header">
          <strong>Case-IN Voice · AI 사전 상담</strong>
          <span class="voice-status" id="voiceStatus"><i class="voice-status-dot" data-state="idle"></i><span id="voiceStatusText">준비 중</span></span>
          <button type="button" class="btn voice-close" id="voiceCloseBtn" aria-label="닫기">✕</button>
        </div>
        <div class="voice-body" id="voiceBody"></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#voiceCloseBtn').onclick = () => {
      if (!confirm('AI 사전 상담을 종료할까요? 저장하지 않은 내용은 사라집니다.')) return;
      closeOverlay();
    };
    return el;
  }

  function setStatus(state, text) {
    const dot = overlayEl.querySelector('#voiceStatus .voice-status-dot');
    const label = overlayEl.querySelector('#voiceStatusText');
    if (dot) dot.dataset.state = state;
    if (label) label.textContent = text;
  }

  // ---------- 1. 동의 화면 ----------
  function renderConsentScreen() {
    const needsName = mode === 'new';
    const existingName = mode === 'existing' && typeof current !== 'undefined' && current ? current.data.name || '' : '';
    const body = overlayEl.querySelector('#voiceBody');
    body.innerHTML = `
      <div class="voice-consent">
        <h2>AI 사전 상담을 시작하기 전에</h2>
        ${needsName
          ? `<label class="field">어르신 성함 (Case-IN 목록 등록용, AI에게 전달되지 않음)<input type="text" id="voiceElderName" placeholder="예: 김OO"></label>`
          : `<p class="help">대상: <b>${esc(existingName || '이름 미입력')}</b></p>`}
        <div class="notice voice-consent-notice">
          <p>이 대화는 <b>정식 초기면접이 아니라</b>, 담당 사회복지사가 방문·상담하기 전에 어르신 상황을 미리 파악하기 위한 사전 상담입니다. 정식 초기면접(개인정보 확인 포함)은 담당 선생님이 직접 진행합니다.</p>
          <p>오늘 하루 지내신 이야기, 건강, 기분, 가족·이웃과의 관계, 요즘 힘든 점 등을 편하게 나누며, AI는 필요한 내용만 구조화하여 화면에 표시합니다.</p>
          <p><b>주민등록번호·상세 주소·전화번호·계좌번호·성함 등 개인정보는 묻지 않으며, AI에게 전달되지도 않습니다.</b></p>
          <p>음성 원본은 저장되지 않으며, 대화 전문도 별도로 영구 저장되지 않습니다.</p>
          <p>AI가 파악한 내용은 사회복지사가 검토·수정한 뒤에만 Case-IN 기록에 참고자료로 반영됩니다. AI는 진단이나 서비스 적격 여부를 판단하지 않습니다.</p>
          <p>언제든지 화면의 <b>[직원에게 전환]</b> 버튼으로 AI 대화를 중단하고 직원에게 도움을 요청할 수 있습니다.</p>
        </div>
        <label class="voice-consent-check"><input type="checkbox" id="voiceConsentCheck"> 위 내용을 확인하였으며, 마이크 사용 및 AI 사전 상담 진행에 동의합니다.</label>
        <div class="actions voice-consent-actions">
          <button type="button" class="btn" id="voiceConsentCancel">취소</button>
          <button type="button" class="btn primary voice-btn-lg" id="voiceConsentStart" disabled>동의하고 시작</button>
        </div>
      </div>`;
    const check = body.querySelector('#voiceConsentCheck');
    const startBtn = body.querySelector('#voiceConsentStart');
    const nameInput = body.querySelector('#voiceElderName');
    function refreshStartEnabled() {
      const nameOk = !needsName || (nameInput && nameInput.value.trim());
      startBtn.disabled = !(check.checked && nameOk);
    }
    check.onchange = refreshStartEnabled;
    if (nameInput) nameInput.oninput = refreshStartEnabled;
    body.querySelector('#voiceConsentCancel').onclick = closeOverlay;
    startBtn.onclick = () => {
      pendingElderName = needsName ? nameInput.value.trim() : existingName;
      try {
        localStorage.setItem(CONSENT_KEY, '1');
      } catch {}
      startInterview();
    };
  }

  // ---------- 2. 진행 화면 ----------
  function renderActiveScreen() {
    const body = overlayEl.querySelector('#voiceBody');
    body.innerHTML = `
      <div class="voice-active">
        <div class="voice-avatar-col" id="voiceAvatarCol"></div>
        <div class="voice-panel-col">
          <h3>실시간 파악 내용</h3>
          <div class="voice-findings-list" id="voiceFindingsList"><p class="voice-empty">아직 확인된 내용이 없습니다.</p></div>
          <div id="voiceTipsWrap" style="display:none;margin-top:14px">
            <h3>💡 어르신께 안내한 정보</h3>
            <div class="voice-findings-list" id="voiceTipsList"></div>
          </div>
        </div>
      </div>
      <div class="voice-footer">
        <button type="button" class="btn voice-btn-lg" id="voicePauseBtn">일시정지</button>
        <button type="button" class="btn danger voice-btn-lg" id="voiceHandoffBtn">직원에게 전환</button>
        <button type="button" class="btn primary voice-btn-lg" id="voiceEndBtn">사전상담 종료</button>
      </div>`;
    avatar = window.AvatarAdapter.create(body.querySelector('#voiceAvatarCol'));
    body.querySelector('#voicePauseBtn').onclick = togglePause;
    body.querySelector('#voiceHandoffBtn').onclick = () => endSession('handoff');
    body.querySelector('#voiceEndBtn').onclick = () => endSession('completed');
  }

  function riskFlag(value) {
    return /자해|학대|방임|위험|극단적/.test(value || '');
  }

  function renderFindingsList() {
    const listEl = overlayEl && overlayEl.querySelector('#voiceFindingsList');
    if (!listEl) return;
    if (!findings.length) {
      listEl.innerHTML = '<p class="voice-empty">아직 확인된 내용이 없습니다.</p>';
      return;
    }
    listEl.innerHTML = findings
      .map((f, i) => {
        const mark = f.status === 'confirmed' ? '✓' : '?';
        const cls = f.status === 'confirmed' ? 'voice-mark-ok' : 'voice-mark-check';
        const risk = riskFlag(f.value) ? '<span class="voice-risk-tag">⚠ 직원 확인 권장</span>' : '';
        return `<div class="voice-finding-item" data-idx="${i}">
          <span class="${cls}">${mark}</span>
          <span class="voice-finding-text"><b>${esc(f.field)}</b>: ${esc(f.value)}</span>
          ${risk}
          <button type="button" class="voice-finding-remove" data-remove="${i}" aria-label="삭제">✕</button>
        </div>`;
      })
      .join('');
    listEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = () => {
        findings.splice(+btn.dataset.remove, 1);
        renderFindingsList();
      };
    });
  }

  function applyUpdates(updates) {
    updates.forEach((u) => {
      if (!u || !u.value) return;
      findings.push({
        category: u.category || 'other',
        field: u.field || u.category || '확인된 내용',
        value: String(u.value),
        status: u.status === 'confirmed' ? 'confirmed' : 'needs_confirmation',
        ts: Date.now()
      });
    });
    renderFindingsList();
  }

  // 진단·처방이 아닌 일반적인 생활정보를 AI가 어르신께 안내했을 때, 사회복지사도 참고할 수 있도록 보여준다.
  function applyTip(topic, tip) {
    if (!tip) return;
    tips.push({ topic: topic || '', tip: String(tip) });
    renderTipsList();
  }

  function renderTipsList() {
    const wrap = overlayEl && overlayEl.querySelector('#voiceTipsWrap');
    const listEl = overlayEl && overlayEl.querySelector('#voiceTipsList');
    if (!wrap || !listEl) return;
    if (!tips.length) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    listEl.innerHTML = tips
      .map((t) => `<div class="voice-finding-item"><span class="voice-finding-text">💡 ${esc(t.tip)}</span></div>`)
      .join('');
  }

  function togglePause() {
    paused = !paused;
    const btn = overlayEl.querySelector('#voicePauseBtn');
    if (paused) {
      client && client.setMicEnabled(false);
      avatar && avatar.setPaused();
      btn.textContent = '재개';
      setStatus('paused', '일시정지됨');
    } else {
      client && client.setMicEnabled(true);
      avatar && avatar.stop();
      btn.textContent = '일시정지';
      setStatus('active', 'AI 연결됨');
    }
  }

  function handleFunctionCall(evt) {
    let args = null;
    try {
      args = JSON.parse(evt.arguments || '{}');
    } catch {
      args = null;
    }
    if (evt.name === 'record_intake_findings') {
      if (args && Array.isArray(args.updates)) applyUpdates(args.updates);
    } else if (evt.name === 'share_wellness_tip') {
      if (args && args.tip) applyTip(args.topic, args.tip);
    } else {
      return;
    }
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
        renderErrorScreen(evt.error?.message || 'AI 응답 중 오류가 발생했습니다.');
        break;
      default:
        break;
    }
  }

  async function startInterview() {
    setStatus('connecting', '연결 중…');
    renderActiveScreen();
    greetingSent = false;
    client = new window.RealtimeVoiceClient({
      onEvent: handleRealtimeEvent,
      onConnectionState: (state) => {
        if (state === 'connected') {
          sessionActive = true;
          setStatus('active', 'AI 연결됨');
          if (!greetingSent) {
            greetingSent = true;
            avatar && avatar.setThinking(true);
            client.sendEvent({ type: 'response.create' });
            clearCallTimers();
            wrapupTimer = setTimeout(() => {
              if (client) client.sendEvent({ type: 'response.create', response: { instructions: WRAPUP_NUDGE } });
            }, WRAPUP_AT_MS);
            hardCutoffTimer = setTimeout(() => {
              endSession('completed');
            }, MAX_CALL_MS);
          }
        } else if (state === 'failed' || state === 'disconnected') {
          if (sessionActive) setStatus('error', '연결이 끊어졌습니다');
        }
      }
    });
    try {
      await client.connect();
    } catch (err) {
      handleConnectError(err);
    }
  }

  function handleConnectError(err) {
    const message = String(err && err.message ? err.message : err);
    const name = err && err.name ? err.name : '';
    let guide = '잠시 후 다시 시도해 주세요. 인터넷 연결 상태를 확인해 주세요.';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /Permission denied|NotAllowedError|마이크/.test(message)) {
      guide = '마이크 권한이 거부되었습니다. 브라우저 주소창의 자물쇠(또는 마이크) 아이콘을 눌러 마이크 접근을 허용한 뒤 다시 시도해 주세요.';
    }
    renderErrorScreen(message + '\n' + guide);
  }

  function renderErrorScreen(message) {
    setStatus('error', '오류');
    const body = overlayEl.querySelector('#voiceBody');
    body.innerHTML = `
      <div class="voice-consent">
        <h2>AI 음성 연결에 문제가 발생했습니다</h2>
        <div class="notice">${esc(message)}</div>
        <p class="help">지금까지 Case-IN에 저장된 정보는 영향을 받지 않았습니다. 기존 방식대로 초기면접지를 계속 작성하실 수 있습니다.</p>
        <div class="actions voice-consent-actions">
          <button type="button" class="btn" id="voiceErrorClose">닫기</button>
          ${findings.length ? '<button type="button" class="btn primary voice-btn-lg" id="voiceErrorReview">지금까지 확인된 내용 검토</button>' : ''}
        </div>
      </div>`;
    body.querySelector('#voiceErrorClose').onclick = closeOverlay;
    const reviewBtn = body.querySelector('#voiceErrorReview');
    if (reviewBtn) reviewBtn.onclick = () => renderReviewScreen(null);
  }

  // ---------- 3. 종료 처리 ----------
  async function endSession(reason) {
    clearCallTimers();
    if (client) {
      client.disconnect();
      client = null;
    }
    sessionActive = false;
    if (reason === 'completed') {
      setStatus('active', '면접 내용 정리 중…');
      const summary = await generateSummarySafe();
      renderReviewScreen(summary);
    } else {
      renderReviewScreen(null);
    }
  }

  async function generateSummarySafe() {
    if (!findings.length) return null;
    try {
      const res = await fetch('/api/interview-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findings })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || '요약 생성 실패');
      return payload.summary;
    } catch (err) {
      return { error: String(err.message || err) };
    }
  }

  // ---------- 4. 검토 및 저장 화면 ----------
  function renderReviewScreen(summary) {
    summaryResult = summary;
    setStatus('review', '사회복지사 검토 대기');
    const schema = window.CaseInVoiceSchema;
    const mappedRows = [];
    const unmatched = [];
    findings.forEach((f) => {
      const matched = schema.mapFinding(f);
      if (matched) mappedRows.push({ finding: f, matched });
      else unmatched.push(f);
    });
    const scoringCandidates = schema.matchScoringCandidates(findings);

    const body = overlayEl.querySelector('#voiceBody');
    body.innerHTML = `
      <div class="voice-review">
        <h2>AI 사전 상담 결과 — 사회복지사 검토</h2>
        <p class="help">이 내용은 정식 초기면접 전에 참고하는 사전 정보입니다. 체크한 항목만 Case-IN에 반영됩니다 — 대화 중 명확히 확인된 내용(✓)은 기본으로 체크되어 있고, 애매한 내용(?)만 직접 확인 후 체크해 주세요. AI는 진단이나 서비스 적격 여부를 판정하지 않았습니다.</p>

        ${summary && !summary.error ? renderSummaryBlock(summary) : summary && summary.error ? `<div class="notice">브리핑 생성에 실패했습니다: ${esc(summary.error)}</div>` : ''}

        <h3>Case-IN 필드에 참고로 반영할 수 있는 항목 (${mappedRows.length})</h3>
        <div class="voice-review-list" id="voiceMappedList">
          ${mappedRows.length ? mappedRows.map((r, i) => renderMappedRow(r, i)).join('') : '<p class="voice-empty">일치하는 항목이 없습니다.</p>'}
        </div>

        ${scoringCandidates.length ? `<h3>선정기준표 자동 반영 후보 (${scoringCandidates.length})</h3>
        <div class="voice-review-list" id="voiceScoringList">
          ${scoringCandidates.map((c, i) => renderScoringRow(c, i)).join('')}
        </div>` : ''}

        <h3>방문 전 참고 메모 · 추가 확인사항 (${unmatched.length})</h3>
        <div class="voice-review-list" id="voiceNotesList">
          ${unmatched.length ? unmatched.map((f, i) => renderNoteRow(f, i)).join('') : '<p class="voice-empty">없음</p>'}
        </div>

        <div class="actions voice-consent-actions">
          <button type="button" class="btn" id="voiceReviewCancel">저장하지 않고 닫기</button>
          ${!summary ? '<button type="button" class="btn" id="voiceReviewSummarize">AI 브리핑 생성</button>' : ''}
          <button type="button" class="btn primary voice-btn-lg" id="voiceReviewSave">사회복지사 확인 및 저장</button>
        </div>
      </div>`;

    body.__mappedRows = mappedRows;
    body.__unmatched = unmatched;
    body.__scoringCandidates = scoringCandidates;

    body.querySelector('#voiceReviewCancel').onclick = closeOverlay;
    const summarizeBtn = body.querySelector('#voiceReviewSummarize');
    if (summarizeBtn) {
      summarizeBtn.onclick = async () => {
        summarizeBtn.disabled = true;
        summarizeBtn.textContent = '생성 중…';
        const s = await generateSummarySafe();
        renderReviewScreen(s);
      };
    }
    body.querySelector('#voiceReviewSave').onclick = () => commitToCase(body);
  }

  function renderSummaryBlock(summary) {
    const rows = [
      ['주요 호소내용', summary.mainComplaint],
      ['개인적 욕구', summary.personalNeeds],
      ['가족·관계적 욕구', summary.familyNeeds],
      ['건강 관련 욕구', summary.healthNeeds],
      ['지역사회·환경적 욕구', summary.communityNeeds],
      ['서비스 욕구', summary.serviceNeeds],
      ['강점과 자원', summary.strengths],
      ['추가 확인 필요사항', summary.needsConfirmation],
      ['방문 시 살펴볼 점', summary.visitFocus],
      ['사전 상담 요약', summary.summary]
    ];
    return `<div class="notice voice-summary-block">${rows
      .map(([label, val]) => `<p><b>${esc(label)}</b>: ${esc(val || '확인된 내용 없음')}</p>`)
      .join('')}</div>`;
  }

  function renderMappedRow(row, i) {
    const { finding, matched } = row;
    const optionText = matched.kind === 'single' ? matched.matchedOption : matched.matchedOptions.join(', ');
    // 대화 중 명확히 확인된(confirmed) 내용은 기본으로 체크해두고, 애매한(needs_confirmation)
    // 내용만 사회복지사가 직접 확인하도록 미체크로 둔다.
    const checkedDefault = finding.status === 'confirmed';
    return `<div class="voice-review-row${checkedDefault ? ' voice-row-confirmed' : ''}">
      <label><span class="voice-toggle"><input type="checkbox" data-mapped-idx="${i}" ${checkedDefault ? 'checked' : ''}><span class="voice-toggle-track"></span></span>
      <b>${esc(matched.label)}</b> → <input type="text" data-mapped-value="${i}" value="${esc(optionText)}"></label>
      <span class="voice-review-source">${checkedDefault ? '✓ 확인됨 · ' : '? 추가 확인 필요 · '}근거: "${esc(finding.value)}"</span>
    </div>`;
  }

  function renderScoringRow(c, i) {
    return `<div class="voice-review-row">
      <label><span class="voice-toggle"><input type="checkbox" data-scoring-idx="${i}"><span class="voice-toggle-track"></span></span>
      <b>${esc(c.domain)} · ${esc(c.label)}</b> → ${esc(c.optionText)}</label>
      <span class="voice-review-source">근거: "${esc(c.sourceField)}"</span>
    </div>`;
  }

  function renderNoteRow(f, i) {
    return `<div class="voice-review-row">
      <label><span class="voice-toggle"><input type="checkbox" data-note-idx="${i}" checked><span class="voice-toggle-track"></span></span>
      <b>${esc(window.CaseInVoiceSchema.CATEGORY_LABELS[f.category] || f.category)}</b>:
      <input type="text" data-note-value="${i}" value="${esc(f.field + ' — ' + f.value)}"></label>
    </div>`;
  }

  function commitToCase(body) {
    const mappedRows = body.__mappedRows;
    const scoringCandidates = body.__scoringCandidates;
    const unmatched = body.__unmatched;

    if (mode === 'existing' && targetCaseId && typeof records !== 'undefined') {
      const existingRecord = records.find((r) => r.id === targetCaseId);
      if (existingRecord) {
        current = existingRecord;
      } else {
        mode = 'new'; // 대상 사례가 그 사이 삭제된 경우 새 사례로 대체 생성
      }
    }
    if (mode === 'new') {
      const newBtn = document.querySelector('#new');
      if (newBtn) newBtn.click(); // 기존 앱의 신규 사례 생성 로직을 그대로 재사용
      if (typeof current !== 'undefined' && current && pendingElderName) {
        current.data.name = pendingElderName;
      }
    }
    if (typeof current === 'undefined' || !current) {
      alert('저장할 사례를 찾을 수 없습니다.');
      return;
    }

    body.querySelectorAll('[data-mapped-idx]').forEach((chk) => {
      if (!chk.checked) return;
      const i = +chk.dataset.mappedIdx;
      const row = mappedRows[i];
      const valueInput = body.querySelector(`[data-mapped-value="${i}"]`);
      const value = valueInput ? valueInput.value : '';
      if (row.matched.kind === 'single') {
        current.data[row.matched.fieldKey] = [value];
      } else {
        const existing = Array.isArray(current.data[row.matched.fieldKey]) ? current.data[row.matched.fieldKey] : [];
        const additions = value.split(',').map((s) => s.trim()).filter(Boolean);
        current.data[row.matched.fieldKey] = Array.from(new Set([...existing, ...additions]));
      }
    });

    body.querySelectorAll('[data-scoring-idx]').forEach((chk) => {
      if (!chk.checked) return;
      const i = +chk.dataset.scoringIdx;
      const c = scoringCandidates[i];
      current.data['s' + c.scoringIndex] = c.optionText;
    });

    const noteLines = [];
    body.querySelectorAll('[data-note-idx]').forEach((chk) => {
      if (!chk.checked) return;
      const i = +chk.dataset.noteIdx;
      const input = body.querySelector(`[data-note-value="${i}"]`);
      noteLines.push('- ' + (input ? input.value : JSON.stringify(unmatched[i])));
    });
    if (noteLines.length) {
      const header = `[AI 사전 상담 메모 · ${new Date().toLocaleString('ko-KR')}]`;
      const prev = current.data.voiceAdditionalNotes ? current.data.voiceAdditionalNotes + '\n\n' : '';
      current.data.voiceAdditionalNotes = prev + header + '\n' + noteLines.join('\n');
    }
    if (summaryResult && !summaryResult.error) {
      current.data.voiceInterviewSummary = summaryResult;
    }

    const tokenToPurge = remoteToken;
    saveCase()
      .then(() => {
        tab = 0;
        renderEditor();
        alert('AI 사전 상담 결과가 저장되었습니다. 정식 초기면접은 담당 사회복지사가 이어서 진행해 주세요.');
        closeOverlay();
        if (tokenToPurge) {
          // 서버에는 확인 전까지만 임시 보관한다. 저장이 끝나면 즉시 삭제한다(개인정보 최소 보관 원칙).
          fetch(`/api/remote-session?token=${encodeURIComponent(tokenToPurge)}`, { method: 'DELETE' }).catch(() => {});
          removePendingLink(tokenToPurge);
        }
      })
      .catch((err) => {
        alert('저장 중 오류가 발생했습니다: ' + err.message);
      });
  }

  // ---------- 5. 사전 상담 링크 만들기 (원격) ----------
  function renderRemoteSendScreen() {
    const needsName = mode === 'new';
    const existingName = mode === 'existing' && typeof current !== 'undefined' && current ? current.data.name || '' : '';
    const body = overlayEl.querySelector('#voiceBody');
    body.innerHTML = `
      <div class="voice-consent">
        <h2>사전 상담 링크 만들기</h2>
        ${needsName
          ? `<label class="field">어르신 성함 (Case-IN 목록 등록용, AI에게 전달되지 않음)<input type="text" id="rcElderName" placeholder="예: 김OO"></label>`
          : `<p class="help">대상: <b>${esc(existingName || '이름 미입력')}</b></p>`}
        <p class="help">버튼을 누르면 어르신이 직접 열어볼 수 있는 사전 상담 링크가 만들어집니다. 이 링크를 문자·카카오톡·이메일 등 원하시는 방법으로 직접 전달해 주세요. 어르신이 대화를 마치면 홈 화면의 "사전상담 진행 현황"에 자동으로 표시됩니다. 사회복지사가 확인·수정한 뒤에만 Case-IN에 저장됩니다.</p>
        <div class="actions voice-consent-actions">
          <button type="button" class="btn" id="rcCancel">취소</button>
          <button type="button" class="btn primary voice-btn-lg" id="rcCreate" ${needsName ? 'disabled' : ''}>링크 만들기</button>
        </div>
      </div>`;
    const nameInput = body.querySelector('#rcElderName');
    const createBtn = body.querySelector('#rcCreate');
    if (nameInput) {
      nameInput.oninput = () => {
        createBtn.disabled = !nameInput.value.trim();
      };
    }
    body.querySelector('#rcCancel').onclick = closeOverlay;
    createBtn.onclick = () => createRemoteLink(needsName ? nameInput.value.trim() : existingName);
  }

  async function createRemoteLink(elderName) {
    const body = overlayEl.querySelector('#voiceBody');
    const createBtn = body.querySelector('#rcCreate');
    createBtn.disabled = true;
    createBtn.textContent = '만드는 중…';
    try {
      const createRes = await fetch('/api/remote-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: elderName })
      });
      const createPayload = await createRes.json();
      if (!createRes.ok) throw new Error(createPayload.error || '링크 생성에 실패했습니다.');
      remoteToken = createPayload.token;
      const caseIdAtCreation = mode === 'existing' && typeof current !== 'undefined' && current ? current.id : null;
      addPendingLink({ token: remoteToken, name: elderName, caseId: caseIdAtCreation, createdAt: Date.now(), status: 'pending' });
      const link = `${location.origin}/pre-consult.html?t=${encodeURIComponent(remoteToken)}`;
      renderRemoteWaiting(link);
    } catch (err) {
      alert(err.message);
      createBtn.disabled = false;
      createBtn.textContent = '링크 만들기';
    }
  }

  function renderRemoteWaiting(link) {
    const body = overlayEl.querySelector('#voiceBody');
    body.innerHTML = `
      <div class="voice-consent">
        <h2>링크가 만들어졌습니다</h2>
        <div class="notice">아래 링크를 복사해서 문자·카카오톡·이메일 등 편하신 방법으로 어르신께 전달해 주세요. 어르신이 대화를 마치면 자동으로 알려드립니다.</div>
        <label class="field">사전 상담 링크
          <div style="display:flex;gap:8px">
            <input type="text" id="rcLinkField" readonly value="${esc(link)}" style="flex:1">
            <button type="button" class="btn" id="rcCopyBtn">복사</button>
          </div>
        </label>
        <p class="voice-empty" id="rcWaitingStatus">어르신 응답 대기 중…</p>
        <div class="actions voice-consent-actions">
          <button type="button" class="btn" id="rcWaitCancel">닫기 (백그라운드에서 계속 대기)</button>
          <button type="button" class="btn primary voice-btn-lg" id="rcRefresh">지금 확인</button>
        </div>
      </div>`;
    body.querySelector('#rcWaitCancel').onclick = closeOverlay;
    body.querySelector('#rcRefresh').onclick = () => checkRemoteStatus(true);
    body.querySelector('#rcCopyBtn').onclick = () => copyRemoteLink(link);

    if (remotePollTimer) clearInterval(remotePollTimer);
    remotePollTimer = setInterval(() => checkRemoteStatus(false), 10000);
  }

  function copyRemoteLink(link) {
    const btn = overlayEl && overlayEl.querySelector('#rcCopyBtn');
    const markCopied = () => {
      if (!btn) return;
      btn.textContent = '복사됨';
      setTimeout(() => {
        if (btn) btn.textContent = '복사';
      }, 1500);
    };
    const fallback = () => {
      const field = overlayEl && overlayEl.querySelector('#rcLinkField');
      if (field) {
        field.select();
        try {
          document.execCommand('copy');
          markCopied();
        } catch {
          alert('복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.');
        }
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(markCopied).catch(fallback);
    } else {
      fallback();
    }
  }

  async function checkRemoteStatus(manual) {
    if (!remoteToken) return;
    try {
      const res = await fetch(`/api/remote-session?token=${encodeURIComponent(remoteToken)}`);
      const record = await res.json();
      if (!res.ok) throw new Error(record.error || '조회 실패');
      if (record.status === 'completed') {
        if (remotePollTimer) {
          clearInterval(remotePollTimer);
          remotePollTimer = null;
        }
        updatePendingLinkStatus(remoteToken, 'completed');
        pendingElderName = record.name || pendingElderName;
        findings = Array.isArray(record.findings) ? record.findings : [];
        summaryResult = record.summary || null;
        renderReviewScreen(summaryResult);
      } else if (manual) {
        const statusEl = overlayEl && overlayEl.querySelector('#rcWaitingStatus');
        if (statusEl) statusEl.textContent = '아직 어르신이 상담을 마치지 않으셨습니다. (자동으로 계속 확인 중)';
      }
    } catch (err) {
      if (manual) alert('상태 확인 중 오류: ' + err.message);
    }
  }

  // ---------- 진입점 ----------
  window.openVoiceInterview = function (startMode) {
    mode = startMode === 'existing' ? 'existing' : 'new';
    findings = [];
    tips = [];
    summaryResult = null;
    remoteToken = null;
    pendingElderName = '';
    targetCaseId = null;
    overlayEl = buildShell();
    renderConsentScreen();
  };

  window.openRemoteConsult = function (startMode) {
    mode = startMode === 'existing' ? 'existing' : 'new';
    findings = [];
    tips = [];
    summaryResult = null;
    remoteToken = null;
    pendingElderName = '';
    targetCaseId = null;
    overlayEl = buildShell();
    renderRemoteSendScreen();
  };

  const refreshAllBtn = document.querySelector('#pendingConsultRefreshAll');
  if (refreshAllBtn) {
    refreshAllBtn.onclick = () => {
      refreshAllBtn.disabled = true;
      refreshAllPendingStatuses().finally(() => {
        refreshAllBtn.disabled = false;
      });
    };
  }
  renderPendingConsultList();
})();
