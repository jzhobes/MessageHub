export const PlatformMap: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google_chat: 'Google Chat',
  google_voice: 'Google Voice',
  google_mail: 'Gmail',
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
