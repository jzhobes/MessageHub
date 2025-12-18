import { promises as fs } from 'fs';
import path from 'path';
import appConfig from '@/lib/shared/appConfig';

interface FacebookProfile {
  profile_v2?: {
    name?: {
      full_name?: string;
    };
  };
}

interface InstagramProfile {
  profile_user?: {
    string_map_data?: {
      Name?: {
        value?: string;
      };
    };
  }[];
}

interface GoogleChatUserInfo {
  user?: {
    name?: string;
  };
}

/**
 * Discovers potential names for the current user ("Me")
 * by scanning profile JSON files in the data directory.
 */
export async function getMyNames(): Promise<string[]> {
  const myNamesSet = new Set<string>(['Me']);
  const dataDir = appConfig.DATA_PATH;

  // Dynamically find Google Chat user info
  let googleChatUserPath = '';
  const gcUsersDir = path.join(dataDir, 'Google Chat/Users');
  try {
    await fs.access(gcUsersDir);
    const folders = await fs.readdir(gcUsersDir);
    for (const folder of folders) {
      if (folder.startsWith('User ')) {
        const candidate = path.join(gcUsersDir, folder, 'user_info.json');
        try {
          await fs.access(candidate);
          googleChatUserPath = candidate;
          break;
        } catch {
          // File missing in this specific user folder, continue search
        }
      }
    }
  } catch {
    // Directory missing or inaccessible, skip Google Chat discovery
  }

  const profileSources = [
    {
      path: path.join(dataDir, 'Facebook/profile_information/profile_information.json'),
      extract: (data: FacebookProfile) => data?.profile_v2?.name?.full_name,
    },
    {
      path: path.join(dataDir, 'Facebook/personal_information/profile_information/profile_information.json'),
      extract: (data: FacebookProfile) => data?.profile_v2?.name?.full_name,
    },
    {
      path: path.join(dataDir, 'Instagram/personal_information/personal_information.json'),
      extract: (data: InstagramProfile) => data?.profile_user?.[0]?.string_map_data?.Name?.value,
    },
    {
      path: googleChatUserPath,
      extract: (data: GoogleChatUserInfo) => data?.user?.name,
    },
  ];

  for (const source of profileSources) {
    if (!source.path) {
      continue;
    }
    try {
      const fileContent = await fs.readFile(source.path, 'utf8');
      const fileData = JSON.parse(fileContent);
      const foundName = source.extract(fileData);
      if (foundName) {
        myNamesSet.add(foundName);
      }
    } catch {}
  }

  // Fallback if configured via ENV (optional future proofing)
  if (process.env.MY_NAME) {
    myNamesSet.add(process.env.MY_NAME);
  }

  return Array.from(myNamesSet);
}
