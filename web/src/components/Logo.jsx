import { useId } from 'react';

// A diya: flame over a clay lamp. The bowl uses currentColor so it follows the theme.
export default function Logo({ size = 28, className = '' }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg className={`logo ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffcf73" />
          <stop offset=".5" stopColor="#ff9238" />
          <stop offset="1" stopColor="#e5532a" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6dc" />
          <stop offset="1" stopColor="#ffc163" />
        </linearGradient>
      </defs>
      <g className="logo-flame">
        <path fill={`url(#${id}f)`} d="M33 4C34 13 46 21 46 34c0 8.3-6.3 14.5-14 14.5S18 42.3 18 34c0-7 4-11.5 7.5-15.5.5 4.5 2.5 7.5 5 8.5C29 19 30.5 10.5 33 4Z" />
        <path className="logo-core" fill={`url(#${id}c)`} d="M32 26c2.5 5 7 8 7 13.5 0 3.9-3.1 7-7 7s-7-3.1-7-7c0-4.5 4.5-7 7-13.5Z" />
      </g>
      <path className="logo-bowl" fill="currentColor" d="M10 49.5c5 7.5 13 11 22 11s17-3.5 22-11c-7 2.8-14.5 4.1-22 4.1S17 52.3 10 49.5Z" />
    </svg>
  );
}
