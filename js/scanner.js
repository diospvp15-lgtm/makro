// Barcode-Scanner über die Kamera. Nutzt den eingebauten BarcodeDetector (Android/Chrome)
// und sonst die Bibliothek barcode-detector (zxing-wasm), die erst beim ersten Scan geladen wird.

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const POLYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.1.3/dist/es/ponyfill.js/+esm';

let detectorPromise = null;
let stream = null;
let running = false;

function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = FORMATS.filter((f) => supported.includes(f));
          if (formats.length) return new window.BarcodeDetector({ formats });
        } catch {}
      }
      const mod = await import(POLYFILL);
      return new mod.BarcodeDetector({ formats: FORMATS });
    })().catch((e) => {
      detectorPromise = null;
      throw new Error('Der Scanner konnte nicht geladen werden. Internetverbindung prüfen.');
    });
  }
  return detectorPromise;
}

export async function startScan(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Die Kamera ist hier nicht verfügbar. Die App muss über https geöffnet sein.');
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('Kamerazugriff wurde nicht erlaubt. Du kannst ihn in den Einstellungen deines Handys freigeben.');
    throw new Error('Die Kamera konnte nicht gestartet werden.');
  }
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  const detector = await getDetector();
  running = true;
  const loop = async () => {
    if (!running) return;
    if (video.readyState >= 2) {
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((c) => /^\d{8,14}$/.test(c.rawValue));
        if (hit && running) {
          stopScan();
          navigator.vibrate?.(60);
          onCode(hit.rawValue);
          return;
        }
      } catch {}
    }
    setTimeout(loop, 120);
  };
  loop();
}

export function stopScan() {
  running = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}
