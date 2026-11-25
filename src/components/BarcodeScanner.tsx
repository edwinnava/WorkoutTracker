import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/** Camera barcode scanner, with typing the number as a fallback. Calls `onCode` once with the digits. */
export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const done = useRef(false);

  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setProblem('This browser can’t scan barcodes with the camera. Type the number under the barcode instead.');
      return;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        if (!cancelled) setProblem('Couldn’t open the camera. Allow camera access for this app, or type the number under the barcode.');
        return;
      }
      if (cancelled || !video.current) return stream.getTracks().forEach((t) => t.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      const detector = new Ctor({ formats: FORMATS });
      timer = setInterval(async () => {
        if (done.current || !video.current || video.current.readyState < 2) return;
        const found = await detector.detect(video.current).catch(() => []);
        const code = found.find((f) => /^\d{8,14}$/.test(f.rawValue))?.rawValue;
        if (code && !done.current) {
          done.current = true;
          navigator.vibrate?.(60);
          onCode(code);
        }
      }, 250);
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  const digits = typed.replace(/\D/g, '');
  return (
    <Sheet title="Scan a barcode" onClose={onClose}>
      {problem ? (
        <p className="small subtle" style={{ marginTop: 0 }}>
          {problem}
        </p>
      ) : (
        <div className="scanner">
          <video ref={video} playsInline muted />
          <div className="scanner-frame" />
        </div>
      )}
      <form
        className="row"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (digits.length >= 8) onCode(digits);
        }}
      >
        <input className="input" inputMode="numeric" placeholder="Or type the barcode number" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn" disabled={digits.length < 8}>
          Look up
        </button>
      </form>
    </Sheet>
  );
}
