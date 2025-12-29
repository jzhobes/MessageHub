import React from 'react';

import { FaCommentDots, FaFacebook, FaInstagram, FaPhone } from 'react-icons/fa';
import { SiGmail, SiGooglechat } from 'react-icons/si';

interface PlatformIconProps {
  platform: string;
  size?: number;
  active?: boolean;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const PLATFORM_COLORS: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#E4405F',
  google_chat: '#00AC47',
  google_voice: '#34A853',
  google_mail: '#EA4335',
  gmail: '#EA4335',
};

export function PlatformIcon({ platform, size = 20, active = true, color, className, style }: PlatformIconProps) {
  const p = platform?.toLowerCase() || '';

  // Priority: 1. explicit color prop, 2. platform-specific color if active, 3. fallback gray
  const iconColor =
    color || (active ? PLATFORM_COLORS[p] || (p.endsWith('mail') ? PLATFORM_COLORS.gmail : '#666') : '#666');

  if (p === 'facebook') {
    return <FaFacebook size={size} color={iconColor} className={className} style={style} />;
  }
  if (p === 'instagram') {
    return <FaInstagram size={size} color={iconColor} className={className} style={style} />;
  }
  if (p.endsWith('mail') || p === 'google_mail' || p === 'gmail') {
    return <SiGmail size={size} color={iconColor} className={className} style={style} />;
  }
  if (p === 'google_chat') {
    return <SiGooglechat size={size} color={iconColor} className={className} style={style} />;
  }
  if (p === 'google_voice') {
    return <FaPhone size={size} color={iconColor} className={className} style={style} />;
  }

  return <FaCommentDots size={size} color={iconColor} className={className} style={style} />;
}

export default PlatformIcon;
