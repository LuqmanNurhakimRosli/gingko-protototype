// Ginkgo logo: a ginkgo leaf holding a 2D city skyline above floodwater.
// Same drawing as public/logo.svg (the favicon), inline so it scales crisply.

import { useId, type FC } from 'react';

const LEAF = 'M32 55.5 C25 47 11 34.5 4.6 24.6 C2.8 21.6 3.6 17.4 7 15.2 C14 10.6 22.4 8.2 29.4 9.6 L32 13.2 L34.6 9.6 C41.6 8.2 50 10.6 57 15.2 C60.4 17.4 61.2 21.6 59.4 24.6 C53 34.5 39 47 32 55.5 Z';
const WAVE = 'M0 37.6 C4 35.6 8 35.6 12 37.6 S20 39.6 24 37.6 S32 35.6 36 37.6 S44 39.6 48 37.6 S56 35.6 64 37.6';

export const GinkgoMark: FC<{ size?: number; className?: string }> = ({ size = 28, className }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2BD46E" /><stop offset=".6" stopColor="#08A045" /><stop offset="1" stopColor="#05753A" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6FBDF9" /><stop offset="1" stopColor="#1A73E8" />
        </linearGradient>
        <clipPath id={`${id}c`}><path d={LEAF} /></clipPath>
      </defs>
      <path d={LEAF} fill={`url(#${id}l)`} />
      <g clipPath={`url(#${id}c)`}>
        <g stroke="#fff" strokeOpacity=".18" strokeWidth=".8" fill="none">
          <path d="M32 56 L6 18" /><path d="M32 56 L15 11" /><path d="M32 56 L24 9" />
          <path d="M32 56 L40 9" /><path d="M32 56 L49 11" /><path d="M32 56 L58 18" />
        </g>
        <g fill="#fff">
          <rect x="9.5" y="27" width="5.2" height="12" rx=".5" />
          <rect x="15.4" y="21.5" width="5.6" height="17.5" rx=".5" />
          <path d="M21.8 39 V19 L24.6 14.6 L27.4 19 V39 Z" /><rect x="24.1" y="11.2" width="1" height="4" />
          <rect x="28.2" y="23.5" width="6.6" height="15.5" rx=".5" />
          <path d="M35.6 39 V18.4 H40.8 V39 Z" /><rect x="37.7" y="14.6" width=".9" height="4" />
          <rect x="41.6" y="25" width="5.2" height="14" rx=".5" />
          <path d="M47.6 39 V31.8 A4.1 4.1 0 0 1 55.8 31.8 V39 Z" /><rect x="51.3" y="25.8" width=".8" height="2.3" />
          <rect x="56.6" y="26" width="1.7" height="13" />
        </g>
        <path d={`${WAVE} V64 H0 Z`} fill={`url(#${id}w)`} />
        <path d="M0 43 C4 41.3 8 41.3 12 43 S20 44.7 24 43 S32 41.3 36 43 S44 44.7 48 43 S56 41.3 64 43" stroke="#fff" strokeOpacity=".8" strokeWidth="1.3" fill="none" />
      </g>
      <path d="M32 54.5 C32.3 57.4 33.3 59.8 35.4 61.8" stroke="#05753A" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  );
};
