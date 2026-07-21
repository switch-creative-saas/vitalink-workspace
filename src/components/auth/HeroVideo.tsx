import { useRef, useEffect, useState } from 'react';

/* ─────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────── */
interface HeroVideoProps {
  videoSrc?: string;
  poster?: string;
}

/* ─────────────────────────────────────────────────────
   HeroVideo Component
   Minimalist layout: Just the background video and 
   a tiny VitaLink logo in the top-left.
───────────────────────────────────────────────────── */
export function HeroVideo({
  videoSrc,
  poster,
}: HeroVideoProps) {
  const panelRef  = useRef<HTMLDivElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  /* ── 1. Lazy-load src when panel enters viewport ── */
  useEffect(() => {
    if (!videoSrc || !panelRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          const video = videoRef.current;
          if (video && !video.src) {
            video.src = videoSrc;
            video.load();
          }
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [videoSrc]);

  /* ── 2. Respect prefers-reduced-motion ─────────── */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const video = videoRef.current;
    if (!video) return;
    const handle = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        video.pause();
      } else {
        if (video.src) video.play().catch(() => {/* silently ignore */});
      }
    };
    handle(mq);
    mq.addEventListener('change', handle);
    return () => mq.removeEventListener('change', handle);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-black flex-col hidden md:flex" ref={panelRef} aria-hidden="true">
      {/* ── Background Video ─────── */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        onCanPlay={() => setVideoReady(true)}
        style={{ opacity: videoReady ? 1 : 0, transition: 'opacity 1.2s ease' }}
      />

      {/* Poster fallback */}
      {poster && !videoReady && (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* ── Top-Left Minimalist Logo ────────────────────── */}
      <div className="absolute top-8 left-8 z-10 flex items-center gap-3 opacity-0 animate-[fade-in_1s_ease-out_0.5s_forwards]">
        <img
          src="/vitalink-icon.png"
          alt="VitaLink"
          className="h-10 w-10 object-contain drop-shadow-[0_2px_8px_rgba(123,77,255,0.4)]"
        />
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
            VitaLink
          </span>
          <span className="text-[10px] font-medium tracking-wide text-white/60 uppercase">
            Healthcare. Connected.
          </span>
        </div>
      </div>
    </div>
  );
}
