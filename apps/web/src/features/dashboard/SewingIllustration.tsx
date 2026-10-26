/** Close-up of a sewing machine needle over fabric — decorative header for the dashboard side panel. */
export function SewingIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Sewing machine needle stitching fabric">
      <defs>
        <linearGradient id="sw-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8eaee" />
          <stop offset="1" stopColor="#b9bec7" />
        </linearGradient>
        <linearGradient id="sw-fabric" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d5d9df" />
          <stop offset="0.5" stopColor="#9aa1ac" />
          <stop offset="1" stopColor="#6f7783" />
        </linearGradient>
        <linearGradient id="sw-fold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sw-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5b616b" />
          <stop offset="0.35" stopColor="#d9dde3" />
          <stop offset="0.6" stopColor="#8a919c" />
          <stop offset="1" stopColor="#3f444c" />
        </linearGradient>
        <linearGradient id="sw-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f5f7" />
          <stop offset="1" stopColor="#c3c8cf" />
        </linearGradient>
        <radialGradient id="sw-light" cx="0.72" cy="0.1" r="0.7">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="sw-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <rect width="400" height="200" fill="url(#sw-bg)" />
      <rect width="400" height="200" fill="url(#sw-light)" />
      {/* fabric with soft folds */}
      <path d="M0 120 C 80 100, 150 135, 230 118 S 360 92, 400 110 L 400 200 L 0 200 Z" fill="url(#sw-fabric)" />
      <path d="M0 132 C 90 116, 160 150, 240 132 S 350 108, 400 124 L 400 140 C 350 126, 280 150, 230 146 S 80 128, 0 150 Z" fill="url(#sw-fold)" />
      <path d="M0 165 C 100 150, 180 178, 270 162 S 370 150, 400 158 L 400 172 C 360 166, 290 184, 250 180 S 90 166, 0 182 Z" fill="url(#sw-fold)" opacity="0.6" />
      {/* soft background machine bed */}
      <ellipse cx="300" cy="150" rx="120" ry="18" fill="#2f343b" opacity="0.18" filter="url(#sw-blur)" />
      {/* machine head */}
      <path d="M230 0 H 400 V 52 C 360 60, 330 62, 300 60 H 262 C 246 60, 236 50, 234 36 Z" fill="url(#sw-head)" />
      <path d="M236 40 C 240 52, 250 58, 264 58 H 300 C 330 60, 365 56, 400 48" stroke="#9aa1ac" strokeWidth="2" fill="none" />
      {/* needle bar and clamp */}
      <rect x="282" y="56" width="16" height="44" rx="3" fill="url(#sw-metal)" />
      <rect x="276" y="92" width="28" height="12" rx="3" fill="url(#sw-metal)" />
      <circle cx="298" cy="98" r="3" fill="#2f343b" />
      {/* needle */}
      <path d="M288 104 L 292 104 L 291 150 L 290 156 L 289 150 Z" fill="url(#sw-metal)" />
      {/* presser foot */}
      <rect x="306" y="66" width="8" height="58" rx="2" fill="url(#sw-metal)" />
      <path d="M268 124 H 330 C 336 124, 338 130, 332 132 H 270 C 264 132, 262 126, 268 124 Z" fill="url(#sw-metal)" />
      <rect x="284" y="126" width="14" height="4" rx="1" fill="#2f343b" opacity="0.5" />
      {/* thread from needle and stitch line */}
      <path d="M290 112 C 300 116, 304 108, 312 100" stroke="#f1f2f4" strokeWidth="1" fill="none" opacity="0.9" />
      <path d="M40 150 L 286 140" stroke="#f3f4f6" strokeWidth="1.6" strokeDasharray="7 5" opacity="0.85" />
      <path d="M40 152 L 286 142" stroke="#4b5260" strokeWidth="0.6" strokeDasharray="7 5" opacity="0.5" />
    </svg>
  );
}
