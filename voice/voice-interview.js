// Case-IN Voice — 메인 컨트롤러
// index.html의 기존 전역(let current, function saveCase/renderEditor/refreshScores/reload/id 등)을
// classic script 공유 스코프를 통해 그대로 재사용한다. 기존 코드는 전혀 수정하지 않는다.
(function () {
  'use strict';

  const CONSENT_KEY = 'caseInVoiceConsentAcknowledged';

  let overlayEl = null;
  let client = null;
  let avatar = null;
  let mode = 'new'; // 'new' | 'existing'
  let sessionActive = false;
  let paused = false;
  let findings = []; // {category, field, value, status, ts}
  let currentCaption = '';
  let summaryResult = null;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function closeOverlay() {
    if (client) {
      client.disconnect();
      client = null;
    }
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    sessionActive = false;
    paused = false;
    findings = [];
    summaryResult = null;
  }

  function buildShell() {
    const el = document.createElement('div');
    el.id = 'voiceOverlay';
    el.className = 'voice-overlay';
    el.innerHTML = `
      <div class="voice-modal" role="dialog" aria-modal="true" aria-label="Case-IN Voice AI 초기면접">
        <div class="voice-header">
          <strong>Case-IN Voice</strong>
          <span class="voice-status" id="voiceStatus"><i class="voice-status-dot" data-state="idle"></i><span id="voiceStatusText">준비 중</span></span>
          <button type="button" class="btn voice-close" id="voiceCloseBtn" aria-label="닫기">✕</button>
        </div>
        <div class="voice-body" id="voiceBody"></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#voiceCloseBtn').onclick = () => {
      if (!confirm('AI 초기면접을 종료할까요? 저장하지 않은 내용은 사라집니다.')) return;
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
    const body = overlayEl.querySelector('#voiceBody');
    body.innerHTML = `
      <div class="voice-consent">
        <h2>AI 음성 초기면접을 시작하기 전에</h2>
        <div class="notice voice-consent-notice">
          <p>· AI와의 음성 대화로 초기면접 정보를 수집하며, 대화 내용 중 필요한 항목만 구조화되어 화면에 표시됩니다.</p>
          <p>· 음성 원본은 저장되지 않으며, 대화 전문도 별도로 영구 저장되지 않습니다.</p>
          <p>· 주민등록번호·상세 주소·전화번호 등은 AI에게 전달되지 않으며, 화면에서 직접 입력해야 합니다.</p>
          <p>· AI가 파악한 내용은 사회복지사가 검토·수정한 뒤에만 최종 기록으로 저장됩니다. AI는 진단이나 서비스 적격 여부를 판단하지 않습니다.</p>
          <p>· 언제든지 화면의 <b>[직원에게 전환]</b> 버튼으로 AI 대화를 중단하고 직원에게 도움을 요청할 수 있습니다.</p>
        </div>
        <label class="voice-consent-check"><input type="checkbox" id="voiceConsentCheck"> 위 내용을 확인하였으며, 마이크 사용 및 AI 음성 상담 진행에 동의합니다.</label>
        <div class="actions voice-consent-actions">
          <button type="button" class="btn" id="voiceConsentCancel">취소</button>
          <button type="button" class="btn primary voice-btn-lg" id="voiceConsentStart" disabled>동의하고 시작</button>
        </div>
      </div>`;
    const check = body.querySelector('#voiceConsentCheck');
    const startBtn = body.querySelector('#voiceConsentStart');
    check.onchange = () => {
      startBtn.disabled = !check.checked;
    };
    body.querySelector('#voiceConsentCancel').onclick = closeOverlay;
    startBtn.onclick = () => {
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
        </div>
      </div>
      <div class="voice-footer">
        <button type="button" class="btn voice-btn-lg" id="voicePauseBtn">일시정지</button>
        <button type="button" class="btn danger voice-btn-lg" id="voiceHandoffBtn">직원에게 전환</button>
        <button type="button" class="btn primary voice-btn-lg" id="voiceEndBtn">면접 종료</button>
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
        renderErrorScreen(evt.error?.message || 'AI 응답 중 오류가 발생했습니다.');
        break;
      default:
        break;
    }
  }

  async function startInterview() {
    setStatus('connecting', '연결 중…');
    renderActiveScreen();
    client = new window.RealtimeVoiceClient({
      onEvent: handleRealtimeEvent,
      onConnectionState: (state) => {
        if (state === 'connected') {
          sessionActive = true;
          setStatus('active', 'AI 연결됨');
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
        <h2>AI 초기면접 결과 — 사회복지사 검토</h2>
        <p class="help">아래 항목을 확인·수정한 뒤 저장하세요. 체크한 항목만 Case-IN 초기면접지에 반영됩니다. AI는 진단이나 서비스 적격 여부를 판정하지 않습니다.</p>

        ${summary && !summary.error ? renderSummaryBlock(summary) : summary && summary.error ? `<div class="notice">요약 생성에 실패했습니다: ${esc(summary.error)}</div>` : ''}

        <h3>Case-IN 필드로 반영 가능한 항목 (${mappedRows.length})</h3>
        <div class="voice-review-list" id="voiceMappedList">
          ${mappedRows.length ? mappedRows.map((r, i) => renderMappedRow(r, i)).join('') : '<p class="voice-empty">일치하는 항목이 없습니다.</p>'}
        </div>

        ${scoringCandidates.length ? `<h3>선정기준표 자동 반영 후보 (${scoringCandidates.length})</h3>
        <div class="voice-review-list" id="voiceScoringList">
          ${scoringCandidates.map((c, i) => renderScoringRow(c, i)).join('')}
        </div>` : ''}

        <h3>추가 확인사항 (${unmatched.length})</h3>
        <div class="voice-review-list" id="voiceNotesList">
          ${unmatched.length ? unmatched.map((f, i) => renderNoteRow(f, i)).join('') : '<p class="voice-empty">없음</p>'}
        </div>

        <div class="actions voice-consent-actions">
          <button type="button" class="btn" id="voiceReviewCancel">저장하지 않고 닫기</button>
          ${!summary ? '<button type="button" class="btn" id="voiceReviewSummarize">AI 요약 생성</button>' : ''}
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
      ['상담내용 요약', summary.summary]
    ];
    return `<div class="notice voice-summary-block">${rows
      .map(([label, val]) => `<p><b>${esc(label)}</b>: ${esc(val || '확인된 내용 없음')}</p>`)
      .join('')}</div>`;
  }

  function renderMappedRow(row, i) {
    const { finding, matched } = row;
    const optionText = matched.kind === 'single' ? matched.matchedOption : matched.matchedOptions.join(', ');
    const checkedDefault = finding.status === 'confirmed';
    return `<div class="voice-review-row">
      <label><input type="checkbox" data-mapped-idx="${i}" ${checkedDefault ? 'checked' : ''}>
      <b>${esc(matched.label)}</b> → <input type="text" data-mapped-value="${i}" value="${esc(optionText)}"></label>
      <span class="voice-review-source">근거: "${esc(finding.value)}"</span>
    </div>`;
  }

  function renderScoringRow(c, i) {
    return `<div class="voice-review-row">
      <label><input type="checkbox" data-scoring-idx="${i}">
      <b>${esc(c.domain)} · ${esc(c.label)}</b> → ${esc(c.optionText)}</label>
      <span class="voice-review-source">근거: "${esc(c.sourceField)}"</span>
    </div>`;
  }

  function renderNoteRow(f, i) {
    return `<div class="voice-review-row">
      <label><input type="checkbox" data-note-idx="${i}" checked>
      <b>${esc(window.CaseInVoiceSchema.CATEGORY_LABELS[f.category] || f.category)}</b>:
      <input type="text" data-note-value="${i}" value="${esc(f.field + ' — ' + f.value)}"></label>
    </div>`;
  }

  function commitToCase(body) {
    const mappedRows = body.__mappedRows;
    const scoringCandidates = body.__scoringCandidates;
    const unmatched = body.__unmatched;

    if (mode === 'new') {
      const newBtn = document.querySelector('#new');
      if (newBtn) newBtn.click(); // 기존 앱의 신규 사례 생성 로직을 그대로 재사용
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
      const header = `[AI 초기면접 추가 확인사항 · ${new Date().toLocaleString('ko-KR')}]`;
      const prev = current.data.voiceAdditionalNotes ? current.data.voiceAdditionalNotes + '\n\n' : '';
      current.data.voiceAdditionalNotes = prev + header + '\n' + noteLines.join('\n');
    }
    if (summaryResult && !summaryResult.error) {
      current.data.voiceInterviewSummary = summaryResult;
    }

    saveCase()
      .then(() => {
        tab = 0;
        renderEditor();
        alert('AI 초기면접 결과가 저장되었습니다.');
        closeOverlay();
      })
      .catch((err) => {
        alert('저장 중 오류가 발생했습니다: ' + err.message);
      });
  }

  // ---------- 진입점 ----------
  window.openVoiceInterview = function (startMode) {
    mode = startMode === 'existing' ? 'existing' : 'new';
    findings = [];
    summaryResult = null;
    overlayEl = buildShell();
    renderConsentScreen();
  };
})();
