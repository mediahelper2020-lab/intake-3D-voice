// Case-IN Voice — OpenAI Realtime API WebRTC 클라이언트 (브라우저 전용)
// 서버(/api/voice-session)가 발급한 단명 client secret으로 브라우저가 직접
// OpenAI Realtime 엔드포인트와 WebRTC 피어연결을 맺는다. OPENAI_API_KEY는 여기 존재하지 않는다.
(function () {
  'use strict';

  const REALTIME_SDP_URL = 'https://api.openai.com/v1/realtime/calls';

  function RealtimeVoiceClient(handlers) {
    this.handlers = handlers || {};
    this.pc = null;
    this.dataChannel = null;
    this.micStream = null;
    this.remoteAudioEl = null;
    this.model = null;
    this.connected = false;
  }

  RealtimeVoiceClient.prototype.connect = async function () {
    const sessionRes = await fetch('/api/voice-session', { method: 'POST' });
    const sessionPayload = await sessionRes.json();
    if (!sessionRes.ok) {
      throw new Error(sessionPayload.error || '음성 세션 발급에 실패했습니다.');
    }
    const { clientSecret, model } = sessionPayload;
    this.model = model;

    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const pc = new RTCPeerConnection();
    this.pc = pc;

    this.remoteAudioEl = document.createElement('audio');
    this.remoteAudioEl.autoplay = true;
    pc.ontrack = (event) => {
      this.remoteAudioEl.srcObject = event.streams[0];
    };

    this.micStream.getAudioTracks().forEach((track) => pc.addTrack(track, this.micStream));

    const dataChannel = pc.createDataChannel('oai-events');
    this.dataChannel = dataChannel;
    dataChannel.addEventListener('message', (event) => {
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (this.handlers.onEvent) this.handlers.onEvent(parsed);
    });
    dataChannel.addEventListener('open', () => {
      this.connected = true;
      if (this.handlers.onConnectionState) this.handlers.onConnectionState('connected');
    });

    pc.addEventListener('connectionstatechange', () => {
      if (this.handlers.onConnectionState) this.handlers.onConnectionState(pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.connected = false;
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch(REALTIME_SDP_URL, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp'
      }
    });

    if (!sdpRes.ok) {
      const detail = await sdpRes.text().catch(() => '');
      throw new Error(`OpenAI Realtime 서버와 연결하지 못했습니다. (${sdpRes.status}${detail ? ' ' + detail.slice(0, 200) : ''})`);
    }

    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  };

  RealtimeVoiceClient.prototype.setMicEnabled = function (enabled) {
    if (!this.micStream) return;
    this.micStream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  };

  RealtimeVoiceClient.prototype.sendEvent = function (obj) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(obj));
    }
  };

  RealtimeVoiceClient.prototype.disconnect = function () {
    this.connected = false;
    try {
      if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
      if (this.dataChannel) this.dataChannel.close();
    } catch {}
    try {
      if (this.pc) this.pc.close();
    } catch {}
    this.pc = null;
    this.dataChannel = null;
    this.micStream = null;
  };

  window.RealtimeVoiceClient = RealtimeVoiceClient;
})();
