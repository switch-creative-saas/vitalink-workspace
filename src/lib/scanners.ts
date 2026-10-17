// Browser scanning for VitaCards (Web NFC) and patient QR codes (camera +
// BarcodeDetector). Both are optional browser features: callers fall back to
// typed input, which also covers USB card readers that "type" the card number.

type NdefRecord = { recordType: string; data?: DataView };
type NdefReadingEvent = Event & { serialNumber?: string; message?: { records: NdefRecord[] } };
type NdefReaderLike = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (type: 'reading' | 'readingerror', listener: (event: NdefReadingEvent) => void) => void;
};
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

const browser = window as unknown as {
  NDEFReader?: new () => NdefReaderLike;
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
};

export const nfcSupported = () => Boolean(browser.NDEFReader);
export const qrSupported = () => Boolean(browser.BarcodeDetector && navigator.mediaDevices?.getUserMedia);

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Listens for VitaCard taps; reports the card's text record, else its serial number. Returns a stop function. */
export function startNfcScan(onValue: (value: string) => void, onStatus: (status: string) => void): () => void {
  if (!browser.NDEFReader) {
    onStatus('NFC reading is not supported in this browser.');
    return () => undefined;
  }
  const controller = new AbortController();
  const reader = new browser.NDEFReader();
  reader.addEventListener('reading', (event) => {
    const text = event.message?.records.find((record) => record.recordType === 'text' && record.data);
    const value = text?.data ? new TextDecoder().decode(text.data) : event.serialNumber ?? '';
    if (value) onValue(value.trim());
  });
  reader.addEventListener('readingerror', () => onStatus('Could not read that card. Hold it still against the device.'));
  reader.scan({ signal: controller.signal })
    .then(() => onStatus('Hold the VitaCard against the back of this device.'))
    .catch((error: unknown) => onStatus(message(error, 'NFC is not available.')));
  return () => controller.abort();
}

/** Streams the camera into `video` and reports the first QR code it sees. Returns a stop function. */
export function startQrScan(video: HTMLVideoElement, onValue: (value: string) => void, onStatus: (status: string) => void): () => void {
  if (!browser.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
    onStatus('QR scanning is not supported in this browser.');
    return () => undefined;
  }
  let stream: MediaStream | null = null;
  let timer = 0;
  let stopped = false;
  const detector = new browser.BarcodeDetector({ formats: ['qr_code'] });
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(async (media) => {
      if (stopped) { media.getTracks().forEach((track) => track.stop()); return; }
      stream = media;
      video.srcObject = media;
      await video.play();
      onStatus('Point the camera at the patient QR code.');
      const tick = async () => {
        if (stopped) return;
        const codes = await detector.detect(video).catch(() => []);
        if (codes[0]?.rawValue) {
          onValue(codes[0].rawValue.trim());
          return;
        }
        timer = window.setTimeout(() => void tick(), 400);
      };
      void tick();
    })
    .catch((error: unknown) => onStatus(message(error, 'Camera access was blocked.')));
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
}

/** QR payloads are either a bare VitaLink ID / card number or a URL ending in one (…/emr/VL-2026-000002). */
export function codeFromScan(raw: string) {
  const value = raw.trim();
  const match = value.match(/VL-\d{4}-\d{4,}/i);
  return match ? match[0].toUpperCase() : value;
}
