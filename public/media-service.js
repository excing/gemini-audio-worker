const FRAME_INTERVAL_MS = 1000;
const FRAME_JPEG_QUALITY = 0.7;
const MAX_FRAME_WIDTH = 1024;
const STARTUP_DELAY_MS = 300;

export function createMediaService(options = {}) {
  const onFrame = options.onFrame || (() => {});
  const onSourceEnded = options.onSourceEnded || (() => {});

  let activeSource = null;
  let stream = null;
  let captureVideo = null;
  let canvas = null;
  let frameTimer = null;
  let startupTimer = null;
  let displayElement = null;
  let capturing = false;
  let cameraFacingMode = 'user';

  function getCaptureVideo() {
    if (captureVideo) return captureVideo;
    captureVideo = document.createElement('video');
    captureVideo.muted = true;
    captureVideo.playsInline = true;
    captureVideo.autoplay = true;
    return captureVideo;
  }

  function getCanvas() {
    canvas ||= document.createElement('canvas');
    return canvas;
  }

  function bindStream(el) {
    if (!el) return;
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.srcObject = stream;
    const playPromise = el.play?.();
    if (playPromise?.catch) playPromise.catch(() => {});
  }

  function setDisplayElement(el) {
    if (displayElement && displayElement !== el) {
      try { displayElement.srcObject = null; } catch {}
    }
    displayElement = el || null;
    if (displayElement && stream) bindStream(displayElement);
  }

  async function captureFrame() {
    if (!stream || capturing) return;
    capturing = true;
    try {
      const internal = getCaptureVideo();
      if (internal.srcObject !== stream) bindStream(internal);
      const width = internal.videoWidth;
      const height = internal.videoHeight;
      if (!width || !height) return;
      const scale = Math.min(1, MAX_FRAME_WIDTH / width);
      const cw = Math.max(1, Math.floor(width * scale));
      const ch = Math.max(1, Math.floor(height * scale));
      const c = getCanvas();
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(internal, 0, 0, cw, ch);
      const dataUrl = c.toDataURL('image/jpeg', FRAME_JPEG_QUALITY);
      const data = dataUrl.split(',', 2)[1] || '';
      if (!data) return;
      onFrame({ data, mimeType: 'image/jpeg' });
    } catch (err) {
      console.warn('Video frame capture failed', err);
    } finally {
      capturing = false;
    }
  }

  function startFrameLoop() {
    stopFrameLoop();
    startupTimer = setTimeout(captureFrame, STARTUP_DELAY_MS);
    frameTimer = setInterval(captureFrame, FRAME_INTERVAL_MS);
  }

  function stopFrameLoop() {
    if (startupTimer) clearTimeout(startupTimer);
    if (frameTimer) clearInterval(frameTimer);
    startupTimer = null;
    frameTimer = null;
  }

  function handleTrackEnded() {
    const source = activeSource;
    stopInternal();
    onSourceEnded(source);
  }

  function stopInternal() {
    detachStream();
    activeSource = null;
    if (captureVideo) {
      try { captureVideo.srcObject = null; } catch {}
    }
    if (displayElement) {
      try { displayElement.srcObject = null; } catch {}
    }
  }

  async function checkAvailable(source) {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      const error = new Error('当前页面非安全上下文，需 HTTPS 或 localhost');
      error.name = 'InsecureContextError';
      throw error;
    }
    if (!navigator?.mediaDevices) {
      const error = new Error('当前浏览器不支持媒体接口');
      error.name = 'NotSupportedError';
      throw error;
    }
    if (source === 'camera') {
      if (!navigator.mediaDevices.getUserMedia) {
        const error = new Error('当前浏览器不支持摄像头');
        error.name = 'NotSupportedError';
        throw error;
      }
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: 'camera' });
          if (status.state === 'denied') {
            const error = new Error('摄像头权限被拒绝');
            error.name = 'NotAllowedError';
            throw error;
          }
        } catch (err) {
          if (err?.name === 'NotAllowedError') throw err;
        }
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (devices.length && !devices.some((device) => device.kind === 'videoinput')) {
          const error = new Error('未检测到摄像头');
          error.name = 'NotFoundError';
          throw error;
        }
      } catch (err) {
        if (err?.name === 'NotFoundError') throw err;
      }
    } else if (source === 'screen') {
      if (!navigator.mediaDevices.getDisplayMedia) {
        const error = new Error('当前浏览器不支持屏幕分享');
        error.name = 'NotSupportedError';
        throw error;
      }
    }
    return true;
  }

  async function acquireCameraStream(facing) {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: facing }, ...base },
        audio: false,
      });
    } catch (err) {
      if (err?.name !== 'OverconstrainedError' && err?.name !== 'ConstraintNotSatisfiedError') throw err;
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, ...base },
        audio: false,
      });
    }
  }

  function attachStream() {
    if (!stream) return;
    stream.getVideoTracks().forEach((track) => track.addEventListener('ended', handleTrackEnded));
    bindStream(getCaptureVideo());
    if (displayElement) bindStream(displayElement);
    startFrameLoop();
  }

  function detachStream() {
    stopFrameLoop();
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try { track.removeEventListener('ended', handleTrackEnded); } catch {}
      try { track.stop(); } catch {}
    });
    stream = null;
  }

  async function start(source) {
    if (activeSource === source && stream) return true;
    stopInternal();
    await checkAvailable(source);
    if (source === 'camera') {
      stream = await acquireCameraStream(cameraFacingMode);
    } else if (source === 'screen') {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } else {
      return false;
    }
    activeSource = source;
    attachStream();
    return true;
  }

  async function switchCamera() {
    if (activeSource !== 'camera' || !stream) {
      const error = new Error('当前不在摄像头模式');
      error.name = 'InvalidStateError';
      throw error;
    }
    const previous = cameraFacingMode;
    const next = previous === 'user' ? 'environment' : 'user';
    detachStream();
    try {
      stream = await acquireCameraStream(next);
      cameraFacingMode = next;
    } catch (err) {
      try {
        stream = await acquireCameraStream(previous);
      } catch {
        stream = null;
        activeSource = null;
        throw err;
      }
      attachStream();
      throw err;
    }
    attachStream();
    return cameraFacingMode;
  }

  function stop() {
    stopInternal();
  }

  function destroy() {
    stopInternal();
    displayElement = null;
    captureVideo = null;
    canvas = null;
  }

  return {
    start,
    stop,
    destroy,
    checkAvailable,
    switchCamera,
    setDisplayElement,
    getActiveSource: () => activeSource,
    getCameraFacingMode: () => cameraFacingMode,
  };
}
