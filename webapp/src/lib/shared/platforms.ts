export const PlatformMap: Record<string, string> = {
  // DB Value -> Display Label
  google_voice: 'Google Voice',
  google_chat: 'Google Chat',
  google_mail: 'Gmail',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

export const ReversePlatformMap: Record<string, string> = Object.entries(PlatformMap).reduce(
  (acc, [key, value]) => {
    acc[value] = key;
    return acc;
  },
  {} as Record<string, string>,
);

export function getPlatformLabel(dbValue: string): string {
  return PlatformMap[dbValue] || dbValue;
}

export function getPlatformDbValue(label: string): string {
  return ReversePlatformMap[label] || label;
}
