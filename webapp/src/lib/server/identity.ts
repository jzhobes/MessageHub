import { promises as fs } from 'fs';
import path from 'path';
import appConfig from '@/lib/shared/appConfig';
import db from './db';

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
 * by checking the database first, then falling back to scanning profile files.
 */
export async function getMyNames(): Promise<string[]> {
  const myNamesSet = new Set<string>(['Me']);

  // 1. Try reading from the identities table in the database
  try {
    if (db.exists()) {
      const conn = db.get();
      // Check if the table exists first (it might not if setup hasn't run)
      const tableCheck = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='identities'").get();
      if (tableCheck) {
        const rows = conn
          .prepare("SELECT id_value FROM identities WHERE is_me = 1 AND id_type IN ('name', 'email')")
          .all() as { id_value: string }[];
        rows.forEach((r) => myNamesSet.add(r.id_value));

        if (myNamesSet.size > 1) {
          return Array.from(myNamesSet);
        }
      }
    }
  } catch (e) {
    console.warn('[Identity] Could not read identities from DB, falling back to discovery:', e);
  }

  // 2. Fallback Discovery Logic (Scanning JSON Files)
  const dataDir = appConfig.WORKSPACE_PATH;

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
    // Directory missing or inaccessible
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
      const foundValue = source.extract(fileData);
      if (foundValue) {
        if (Array.isArray(foundValue)) {
          foundValue.forEach((v) => myNamesSet.add(v));
        } else {
          myNamesSet.add(foundValue);
        }
      }
    } catch {}
  }

  // Optional ENV fallback
  if (process.env.MY_NAME) {
    myNamesSet.add(process.env.MY_NAME);
  }

  return Array.from(myNamesSet);
}
