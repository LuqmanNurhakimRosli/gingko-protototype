// Ginkgo flood drill — an illustration of an evacuation centre of a given kind
// (school, community hall, mosque, stadium). It shows the type of building, not
// the actual site: palettes and details vary per centre so the list reads well.

import type { FC, ReactNode } from 'react';
import type { ShelterKind } from '../../sim/evac';

interface Props { kind: ShelterKind; seed: number; rain?: boolean; className?: string }

const PALETTES: Record<ShelterKind, { wall: string; trim: string; roof: string; accent: string }[]> = {
  school: [
    { wall: '#F6F1E4', trim: '#2F6FB0', roof: '#C2453A', accent: '#F4C542' },
    { wall: '#FFF8EC', trim: '#8E2D3A', roof: '#5B6B7D', accent: '#E8A33D' },
    { wall: '#EEF5FF', trim: '#1F6E4F', roof: '#B5442F', accent: '#F2C14E' },
  ],
  hall: [
    { wall: '#FDF6EA', trim: '#7A4A2A', roof: '#9C3D2E', accent: '#2F6FB0' },
    { wall: '#F1F6F2', trim: '#2E6B4F', roof: '#3E5A74', accent: '#E0A43A' },
    { wall: '#FFF4E6', trim: '#6B4E9B', roof: '#B35A2B', accent: '#1F8A70' },
  ],
  mosque: [
    { wall: '#FBFAF6', trim: '#1F7A55', roof: '#1F9E6E', accent: '#D4A72C' },
    { wall: '#F7F9FC', trim: '#2C5F9E', roof: '#2F7FD0', accent: '#D4A72C' },
    { wall: '#FFF9EE', trim: '#8B6A2F', roof: '#C9A227', accent: '#1F7A55' },
  ],
  sports: [
    { wall: '#EAF2FA', trim: '#2563A8', roof: '#C9D6E3', accent: '#E8553D' },
    { wall: '#F4F1EA', trim: '#8C3B2E', roof: '#D8D2C4', accent: '#2F6FB0' },
    { wall: '#EEF6F0', trim: '#1E7A4C', roof: '#CFDCD3', accent: '#F2A93B' },
  ],
};

const rnd = (seed: number, k: number) => {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function Tree({ x, y, s, c }: { x: number; y: number; s: number; c: string }) {
  return (
    <g>
      <rect x={x - 1.5 * s} y={y - 10 * s} width={3 * s} height={10 * s} fill="#7B5A3C" />
      <circle cx={x} cy={y - 16 * s} r={9 * s} fill={c} />
      <circle cx={x - 6 * s} cy={y - 11 * s} r={6 * s} fill={c} />
      <circle cx={x + 6 * s} cy={y - 11 * s} r={6 * s} fill={c} />
    </g>
  );
}

function Person({ x, y, c, umbrella }: { x: number; y: number; c: string; umbrella?: string }) {
  return (
    <g>
      {umbrella && <path d={`M${x - 8} ${y - 19} A8 6 0 0 1 ${x + 8} ${y - 19} Z`} fill={umbrella} />}
      {umbrella && <line x1={x} y1={y - 19} x2={x + 1} y2={y - 10} stroke="#333" strokeWidth={0.8} />}
      <circle cx={x} cy={y - 14} r={2.4} fill="#6B4B3A" />
      <rect x={x - 2.4} y={y - 11.5} width={4.8} height={7} rx={1.8} fill={c} />
      <rect x={x - 2} y={y - 5} width={1.6} height={5} fill="#2D3748" />
      <rect x={x + 0.4} y={y - 5} width={1.6} height={5} fill="#2D3748" />
    </g>
  );
}

function PpsSign({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y - 22} width={2} height={22} fill="#5F6368" />
      <rect x={x - 14} y={y - 34} width={30} height={13} rx={2} fill="#08A045" />
      <text x={x + 1} y={y - 25} textAnchor="middle" fontSize={8} fontWeight={800} fill="#fff" fontFamily="Inter, sans-serif">PPS</text>
    </g>
  );
}

function School({ p, seed }: { p: typeof PALETTES.school[number]; seed: number }) {
  const floors = 3;
  const x0 = 46, x1 = 236, base = 132, fh = 22;
  const top = base - floors * fh;
  const cols = 9;
  const parts: ReactNode[] = [];
  for (let f = 0; f < floors; f++) {
    const y = base - (f + 1) * fh;
    for (let c = 0; c < cols; c++) {
      const x = x0 + 10 + c * ((x1 - x0 - 20) / cols);
      parts.push(<rect key={`w${f}-${c}`} x={x + 3} y={y + 5} width={11} height={11} fill={f === 0 && c === 4 ? p.trim : '#BFD9F2'} opacity={0.95} />);
    }
    if (f > 0) {
      parts.push(<rect key={`rl${f}`} x={x0} y={y + fh - 5} width={x1 - x0} height={2.4} fill={p.trim} />);
      for (let b = x0 + 4; b < x1; b += 7) parts.push(<rect key={`b${f}-${b}`} x={b} y={y + fh - 5} width={1} height={5} fill={p.trim} opacity={0.6} />);
    }
  }
  const flagX = 22 + rnd(seed, 3) * 6;
  return (
    <g>
      <rect x={x0} y={top} width={x1 - x0} height={base - top} fill={p.wall} stroke="#D5CFC2" strokeWidth={0.8} />
      {parts}
      <path d={`M${x0 - 8} ${top + 2} L${(x0 + x1) / 2} ${top - 14} L${x1 + 8} ${top + 2} Z`} fill={p.roof} />
      <rect x={x0 - 8} y={top + 1} width={x1 - x0 + 16} height={3} fill={p.roof} opacity={0.75} />
      {/* hall wing */}
      <rect x={244} y={96} width={52} height={36} fill={p.wall} stroke="#D5CFC2" strokeWidth={0.8} />
      <path d="M238 98 L270 80 L302 98 Z" fill={p.roof} />
      <rect x={262} y={110} width={16} height={22} fill={p.trim} />
      {/* flag */}
      <rect x={flagX} y={70} width={1.6} height={62} fill="#9AA0A6" />
      <g transform={`translate(${flagX + 1.6} 71)`}>
        {[0, 1, 2, 3, 4, 5, 6].map(i => <rect key={i} y={i * 2} width={20} height={1} fill={i % 2 ? '#fff' : '#CC0001'} />)}
        <rect width={9} height={7} fill="#010066" />
        <circle cx={3.6} cy={3.5} r={2.2} fill="#FFCC00" /><circle cx={4.3} cy={3.5} r={1.8} fill="#010066" />
      </g>
      <rect x={x0 + 70} y={base - 3} width={50} height={3} fill={p.accent} opacity={0.8} />
    </g>
  );
}

function Hall({ p }: { p: typeof PALETTES.hall[number] }) {
  return (
    <g>
      <rect x={58} y={80} width={204} height={52} fill={p.wall} stroke="#D8CDBA" strokeWidth={0.8} />
      <path d="M44 84 L160 34 L276 84 Z" fill={p.roof} />
      <path d="M118 66 L160 47 L202 66 Z" fill="#fff" opacity={0.18} />
      {[72, 96, 214, 238].map(x => <rect key={x} x={x} y={92} width={14} height={20} rx={1} fill="#BFD9F2" />)}
      {[66, 122, 198, 254].map(x => <rect key={`c${x}`} x={x - 2} y={84} width={4} height={48} fill={p.trim} opacity={0.85} />)}
      <rect x={140} y={100} width={40} height={32} fill={p.trim} />
      <line x1={160} y1={100} x2={160} y2={132} stroke={p.wall} strokeWidth={1.2} />
      <rect x={102} y={84} width={116} height={12} rx={2} fill={p.accent} />
      <text x={160} y={92.8} textAnchor="middle" fontSize={7} fontWeight={800} fill="#fff" letterSpacing={0.4} fontFamily="Inter, sans-serif">DEWAN ORANG RAMAI</text>
      <rect x={52} y={130} width={216} height={4} fill="#C9C2B4" />
    </g>
  );
}

function Mosque({ p }: { p: typeof PALETTES.mosque[number] }) {
  const arches = [92, 118, 202, 228];
  return (
    <g>
      <rect x={74} y={88} width={176} height={44} fill={p.wall} stroke="#DAD5C8" strokeWidth={0.8} />
      <rect x={70} y={84} width={184} height={6} fill={p.trim} />
      {arches.map(x => <path key={x} d={`M${x} 124 V106 A7 8 0 0 1 ${x + 14} 106 V124 Z`} fill="#BFD9F2" />)}
      <path d="M146 132 V108 A14 15 0 0 1 174 108 V132 Z" fill={p.trim} />
      {/* main dome */}
      <rect x={130} y={74} width={60} height={12} fill={p.wall} />
      <path d="M126 76 C126 46 144 34 160 26 C176 34 194 46 194 76 Z" fill={p.roof} />
      <path d="M140 70 C140 52 150 42 160 36" stroke="#fff" strokeOpacity={0.35} strokeWidth={3} fill="none" />
      <rect x={159} y={14} width={2} height={13} fill={p.accent} />
      <circle cx={160} cy={13} r={3.4} fill={p.accent} /><circle cx={161.4} cy={12.4} r={2.8} fill="#BFD9F2" />
      {/* side domes */}
      <path d="M86 86 C86 74 94 68 100 66 C106 68 114 74 114 86 Z" fill={p.roof} />
      <path d="M210 86 C210 74 218 68 224 66 C230 68 238 74 238 86 Z" fill={p.roof} />
      {/* minaret */}
      <rect x={268} y={44} width={16} height={88} fill={p.wall} stroke="#DAD5C8" strokeWidth={0.8} />
      {[70, 96].map(y => <rect key={y} x={265} y={y} width={22} height={4} fill={p.trim} />)}
      <path d="M266 46 C266 34 272 28 276 26 C280 28 286 34 286 46 Z" fill={p.roof} />
      <rect x={275.2} y={16} width={1.6} height={10} fill={p.accent} />
      <rect x={272} y={52} width={8} height={12} rx={4} fill="#BFD9F2" />
    </g>
  );
}

function Sports({ p, seed }: { p: typeof PALETTES.sports[number]; seed: number }) {
  const lights = rnd(seed, 5) > 0.4;
  return (
    <g>
      <path d="M40 132 V82 C80 50 240 50 280 82 V132 Z" fill={p.wall} stroke="#C8D2DC" strokeWidth={0.8} />
      <path d="M36 84 C80 46 240 46 284 84 L280 90 C240 58 80 58 40 90 Z" fill={p.trim} />
      {[0, 1, 2, 3].map(i => <path key={i} d={`M${60 + i * 4} ${96 + i * 8} C100 ${74 + i * 8} 220 ${74 + i * 8} ${260 - i * 4} ${96 + i * 8}`} stroke={p.roof} strokeWidth={3} fill="none" />)}
      <rect x={124} y={104} width={72} height={28} fill="#BFD9F2" stroke={p.trim} strokeWidth={1.2} />
      {[142, 160, 178].map(x => <line key={x} x1={x} y1={104} x2={x} y2={132} stroke={p.trim} strokeWidth={0.8} />)}
      <rect x={120} y={92} width={80} height={10} rx={2} fill={p.accent} />
      <text x={160} y={99.6} textAnchor="middle" fontSize={6.8} fontWeight={800} fill="#fff" letterSpacing={0.6} fontFamily="Inter, sans-serif">KOMPLEKS SUKAN</text>
      {lights && [22, 298].map(x => (
        <g key={x}>
          <rect x={x - 1} y={40} width={2} height={92} fill="#8A939C" />
          <rect x={x - 7} y={36} width={14} height={6} rx={1} fill="#5F6B76" />
          {[-4, 0, 4].map(d => <circle key={d} cx={x + d} cy={39} r={1.4} fill="#FFF6C9" />)}
        </g>
      ))}
    </g>
  );
}

export const ShelterArt: FC<Props> = ({ kind, seed, rain, className }) => {
  const pal = PALETTES[kind][seed % PALETTES[kind].length];
  const treeC = ['#3E9B5A', '#2F8A4C', '#4FAE68'][seed % 3];
  const id = `sa-${kind}-${seed}`;
  const drops: ReactNode[] = [];
  if (rain) for (let i = 0; i < 46; i++) {
    const x = rnd(seed, i) * 340 - 10, y = rnd(seed, i + 100) * 150;
    drops.push(<line key={i} x1={x} y1={y} x2={x - 3} y2={y + 9} stroke="#E8F1FB" strokeOpacity={0.7} strokeWidth={0.9} />);
  }
  return (
    <svg className={className} viewBox="0 0 320 160" role="img" aria-label={`Illustration of a ${kind === 'hall' ? 'community hall' : kind === 'sports' ? 'stadium or sports hall' : kind}`}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={rain ? '#8FA3B8' : '#BFE0FA'} />
          <stop offset="1" stopColor={rain ? '#C9D4DE' : '#EAF5FD'} />
        </linearGradient>
      </defs>
      <rect width="320" height="160" fill={`url(#${id}-sky)`} />
      {!rain && <g fill="#fff" opacity={0.9}>
        <ellipse cx={60 + rnd(seed, 1) * 40} cy={26} rx={22} ry={7} /><ellipse cx={74 + rnd(seed, 1) * 40} cy={21} rx={13} ry={7} />
        <ellipse cx={230 + rnd(seed, 2) * 50} cy={18} rx={18} ry={6} />
      </g>}
      {rain && <g fill="#7D8FA3" opacity={0.6}>
        <ellipse cx={70} cy={18} rx={50} ry={12} /><ellipse cx={240} cy={14} rx={60} ry={13} />
      </g>}
      <path d="M0 112 C50 96 90 104 140 98 C200 92 250 100 320 94 V160 H0 Z" fill={rain ? '#9BB3A0' : '#B9DDB9'} opacity={0.7} />
      <rect y={132} width={320} height={28} fill={rain ? '#8FA88F' : '#9CCB8F'} />
      <rect y={140} width={320} height={20} fill="#9AA0A6" />
      <g stroke="#fff" strokeWidth={1.4} strokeDasharray="10 8"><line x1={0} y1={150} x2={320} y2={150} /></g>
      {kind === 'school' && <School p={pal as typeof PALETTES.school[number]} seed={seed} />}
      {kind === 'hall' && <Hall p={pal as typeof PALETTES.hall[number]} />}
      {kind === 'mosque' && <Mosque p={pal as typeof PALETTES.mosque[number]} />}
      {kind === 'sports' && <Sports p={pal as typeof PALETTES.sports[number]} seed={seed} />}
      <Tree x={8 + rnd(seed, 7) * 10} y={134} s={1} c={treeC} />
      <Tree x={306 - rnd(seed, 8) * 8} y={134} s={0.85} c={treeC} />
      <PpsSign x={kind === 'school' ? 112 : 30} y={136} />
      <Person x={150 + rnd(seed, 9) * 20} y={139} c="#E8553D" umbrella={rain ? '#2F6FB0' : undefined} />
      <Person x={176 + rnd(seed, 10) * 14} y={139} c="#2F80ED" umbrella={rain ? '#F2A93B' : undefined} />
      <Person x={194 + rnd(seed, 11) * 10} y={139.5} c="#08A045" />
      {drops}
    </svg>
  );
};
