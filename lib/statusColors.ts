export const STATUS_COLORS: Record<string, {
  bg: string; header: string; dot: string; label: string; hex: string;
}> = {
  gray:   { bg: 'bg-gray-100 border-gray-300',    header: 'text-gray-700 bg-gray-200',     dot: 'bg-gray-400',    label: 'Gray',   hex: '#9ca3af' },
  blue:   { bg: 'bg-blue-50 border-blue-200',     header: 'text-blue-700 bg-blue-100',     dot: 'bg-blue-500',    label: 'Blue',   hex: '#3b82f6' },
  amber:  { bg: 'bg-amber-50 border-amber-200',   header: 'text-amber-700 bg-amber-100',   dot: 'bg-amber-500',   label: 'Amber',  hex: '#f59e0b' },
  green:  { bg: 'bg-green-50 border-green-200',   header: 'text-green-700 bg-green-100',   dot: 'bg-green-500',   label: 'Green',  hex: '#22c55e' },
  purple: { bg: 'bg-purple-50 border-purple-200', header: 'text-purple-700 bg-purple-100', dot: 'bg-purple-500',  label: 'Purple', hex: '#a855f7' },
  red:    { bg: 'bg-red-50 border-red-200',       header: 'text-red-700 bg-red-100',       dot: 'bg-red-500',     label: 'Red',    hex: '#ef4444' },
  pink:   { bg: 'bg-pink-50 border-pink-200',     header: 'text-pink-700 bg-pink-100',     dot: 'bg-pink-500',    label: 'Pink',   hex: '#ec4899' },
  teal:   { bg: 'bg-teal-50 border-teal-200',     header: 'text-teal-700 bg-teal-100',     dot: 'bg-teal-500',    label: 'Teal',   hex: '#14b8a6' },
  orange: { bg: 'bg-orange-50 border-orange-200', header: 'text-orange-700 bg-orange-100', dot: 'bg-orange-500',  label: 'Orange', hex: '#f97316' },
  indigo: { bg: 'bg-indigo-50 border-indigo-200', header: 'text-indigo-700 bg-indigo-100', dot: 'bg-indigo-500',  label: 'Indigo', hex: '#6366f1' },
};

export const DEFAULT_COLOR = STATUS_COLORS['gray'];

export function getStatusColor(color: string) {
  return STATUS_COLORS[color] ?? DEFAULT_COLOR;
}
