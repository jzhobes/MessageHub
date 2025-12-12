import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '../../utils/config';

// Google Chat type definitions
/** Represents a file attached to a Google Chat message */
interface GoogleChatAttachedFile {
  export_name: string;
}

/** Represents a reaction to a Google Chat message */
interface GoogleChatReaction {
  emoji: {
    unicode: string;
  };
  reactor_emails?: string[];
}

/** Represents a creator/sender in Google Chat */
interface GoogleChatCreator {
  name: string;
}

/** Raw Google Chat message structure from export */
interface GoogleChatMessage {
  created_date?: string;
  updated_date?: string;
  text?: string;
  creator?: GoogleChatCreator;
  attached_files?: GoogleChatAttachedFile[];
  reactions?: GoogleChatReaction[];
  quoted_message_metadata?: {
    creator?: GoogleChatCreator;
    text?: string;
  };
  quotes_message_metadata?: {
    creator?: GoogleChatCreator;
    text?: string;
  };
  message_id?: string;
  annotations?: {
    length: number;
    start_index: number;
    url_metadata?: {
      title?: string;
      image_url?: string;
      url?: {
        private_do_not_access_or_else_safe_url_wrapped_value?: string;
      };
    };
  }[];
}

/** Wrapper for Google Chat export file */
interface GoogleChatData {
  messages: GoogleChatMessage[];
}

/** Unified media item for internal use */
interface MediaItem {
  uri: string;
}

/** Raw Facebook message structure */
interface FacebookMessage {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  is_sender?: boolean;
  photos?: MediaItem[];
  videos?: MediaItem[];
  reactions?: { reaction: string; actor: string }[];
}

/** Wrapper for Facebook/Instagram export file */
interface FacebookData {
  messages: FacebookMessage[];
  [key: string]: unknown;
}

/** Unified Message structure used by the frontend */
interface Message {
  id?: string;
  is_sender?: boolean;
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  photos?: MediaItem[];
  videos?: MediaItem[];
  gifs?: MediaItem[];
  sticker?: { uri: string };
  share?: { link?: string; share_text?: string };
  reactions?: { reaction: string; actor: string }[];
  quoted_message_metadata?: {
    creator?: { name: string };
    text?: string;
  };
}

/** Facebook Profile Information structure */
interface FacebookProfile {
  profile_v2?: {
    name?: {
      full_name?: string;
    };
  };
}

/** Instagram Profile Information structure */
interface InstagramProfile {
  profile_user?: {
    string_map_data?: {
      Name?: {
        value?: string;
      };
    };
  }[];
}

/** Google Chat User Information structure */
interface GoogleChatUserInfo {
  user?: {
    name?: string;
  };
}

/**
 * API Handler to retrieve messages for a specific thread and platform.
 * Normalizes data from different platform export formats into a unified Message structure.
 *
 * @param req - Next.js API request containing 'threadId', 'page', and 'platform' query params.
 * @param res - Next.js API response
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { threadId, page = '1', platform } = req.query;

  if (!threadId) {
    return res.status(400).json({ error: 'Missing threadId' });
  }

  const threadIdStr = Array.isArray(threadId) ? threadId[0] : threadId;
  const pageStr = Array.isArray(page) ? page[0] : page;
  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  // SECURITY: Prevent path traversal
  // Allow alphanumeric, underscores, hyphens, dots, and spaces (for Google Chat folder names)
  // Rejects ".." "/" "\"
  if (!/^[a-zA-Z0-9_\-\. ]+$/.test(threadIdStr)) {
    return res.status(400).json({ error: 'Invalid thread ID' });
  }

  // Identify "Me"
  const myNamesSet = new Set<string>();
  const dataDir = getDataDir();

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
          // continue
        }
      }
    }
  } catch (e) {
    console.warn('[Messages] Failed to search Google Chat users directory', e);
  }

  const profileSources = [
    {
      path: path.join(dataDir, 'Facebook/profile_information/profile_information.json'),
      extract: (data: FacebookProfile) => data?.profile_v2?.name?.full_name,
    },
    {
      path: path.join(dataDir, 'Instagram/personal_information/personal_information.json'),
      extract: (data: InstagramProfile) => data?.profile_user?.[0]?.string_map_data?.Name?.value,
    },
    {
      path: googleChatUserPath, // Dynamic path (empty string if not found, handled by existsSync check below)
      extract: (data: GoogleChatUserInfo) => data?.user?.name,
    },
  ];

  for (const source of profileSources) {
    try {
      // Trying to read file will fail if not exists, so just try read
      const fileContent = await fs.readFile(source.path, 'utf8');
      const fileData = JSON.parse(fileContent);
      const foundName = source.extract(fileData);
      if (foundName) {
        myNamesSet.add(foundName);
      }
    } catch (e) {
      console.warn(`Failed to load profile info from ${source.path}`, e);
    }
  }
  const myNames = Array.from(myNamesSet);

  // Google Chat Handling
  if (platformStr === 'Google Chat') {
    const inboxPath = path.join(dataDir, 'Google Chat/Groups');
    const msgPathOriginal = path.join(inboxPath, threadIdStr, `message_${pageStr}.json`);
    const msgPathProcessed = path.join(inboxPath, threadIdStr, `message_${pageStr}.processed.json`);
    // Prefer processed if exists
    let msgPath = msgPathOriginal;
    try {
      await fs.access(msgPathProcessed);
      msgPath = msgPathProcessed;
    } catch {
      // processed invalid, use original
    }

    console.log(`[Google Chat] Loading messages from: ${msgPath}`);
    try {
      const fileContent = await fs.readFile(msgPath, 'utf8');
      const data: GoogleChatData = JSON.parse(fileContent);
      const rawMessages = data.messages || [];
      console.log(`[Google Chat] Found ${rawMessages.length} raw messages`);

      const googleDateToMs = (dateStr: string) => {
        if (!dateStr) {
          return 0;
        }
        try {
          // "Saturday, July 9, 2022 at 2:03:54 PM UTC"
          const clean = dateStr.replace(' at ', ' ').replace(/\u202f/g, ' ');
          return new Date(clean).getTime();
        } catch {
          return 0;
        }
      };

      const messages = rawMessages.flatMap((m: GoogleChatMessage) => {
        const dateStr = m.created_date || m.updated_date || '';
        const ms = googleDateToMs(dateStr);
        const sender = m.creator?.name || 'Unknown';

        const attached = m.attached_files || [];
        const photos: MediaItem[] = [];
        const videos: MediaItem[] = [];

        attached.forEach((f: GoogleChatAttachedFile) => {
          const ext = path.extname(f.export_name).toLowerCase();
          const uri = `Google Chat/Groups/${threadIdStr}/${f.export_name}`;
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            photos.push({ uri });
          } else if (['.mp4', '.mov'].includes(ext)) {
            videos.push({ uri });
          }
        });

        if (m.annotations) {
          m.annotations.forEach((a) => {
            if (a.url_metadata) {
              const url = a.url_metadata.image_url;
              if (url) {
                photos.push({ uri: url });
              }
            }
          });
        }

        const reactions = (m.reactions || []).flatMap((r: GoogleChatReaction) => {
          const emails = r.reactor_emails || [];
          if (emails.length === 0) {
            // Fallback for missing reactor info
            return [
              {
                reaction: r.emoji.unicode,
                actor: 'Unknown',
              },
            ];
          }
          // Create one reaction entry per reactor
          return emails.map((email) => ({
            reaction: r.emoji.unicode,
            actor: email, // display email as actor since name is unavailable here
          }));
        });

        const result: Message[] = [];
        const hasMedia = photos.length > 0 || videos.length > 0;

        // Determine where to attach reactions (Media prefers, otherwise Text)
        const reactionsForMedia = hasMedia && reactions.length > 0 ? reactions : undefined;
        const reactionsForText = !hasMedia && reactions.length > 0 ? reactions : undefined;

        // Order in array: [Newest (Bottom), ..., Oldest (Top)] (due to column-reverse)
        // We want Text (Oldest/Top) -> Media (Newest/Bottom)
        // So push Media first, then Text.

        if (hasMedia) {
          result.push({
            id: m.message_id ? `${m.message_id}_media` : undefined,
            is_sender: myNames.includes(sender),
            sender_name: sender,
            timestamp_ms: ms,
            content: undefined,
            photos: photos.length > 0 ? photos : undefined,
            videos: videos.length > 0 ? videos : undefined,
            reactions: reactionsForMedia,
          });
        }

        if (m.text || m.quoted_message_metadata) {
          result.push({
            id: m.message_id,
            is_sender: myNames.includes(sender),
            sender_name: sender,
            timestamp_ms: ms,
            content: m.text,
            reactions: reactionsForText,
            quoted_message_metadata: m.quoted_message_metadata
              ? {
                  creator: m.quoted_message_metadata.creator,
                  text: m.quoted_message_metadata.text,
                }
              : undefined,
          });
        }

        // If message is empty (e.g. unsupported attachment), fallback to empty string to prevent data loss.
        if (result.length === 0) {
          result.push({
            sender_name: sender,
            timestamp_ms: ms,
            content: m.text || '',
            reactions: reactions.length > 0 ? reactions : undefined,
          });
        }

        return result;
      });

      // Messages are already in correct order (newest first) from split files
      return res.status(200).json({ messages });
    } catch (e) {
      console.error('Error reading Google Chat messages:', e);
      return res.status(500).json({ error: 'Failed to load messages' });
    }
  }

  // Facebook/Instagram Handling - search across all folders
  if (platformStr === 'Facebook' || platformStr === 'Instagram' || !platformStr) {
    let msgPath: string | null = null;

    if (platformStr === 'Instagram') {
      const messagesRoot = path.join(dataDir, 'Instagram/your_instagram_activity/messages/inbox');
      const filenameBase = `message_${pageStr}`;

      const processed = path.join(messagesRoot, threadIdStr, `${filenameBase}.processed.json`);
      const original = path.join(messagesRoot, threadIdStr, `${filenameBase}.json`);

      try {
        await fs.access(processed);
        msgPath = processed;
      } catch {
        try {
          await fs.access(original);
          msgPath = original;
        } catch {
          // neither found
        }
      }
    } else {
      // Facebook
      const messagesRoot = path.join(dataDir, 'Facebook/your_facebook_activity/messages');
      const foldersToSearch = ['inbox', 'archived_threads', 'legacy_threads', 'e2ee_cutover'];

      // Try to find the thread in each folder
      for (const folder of foldersToSearch) {
        const filenameBase = `message_${pageStr}`;
        const processed = path.join(messagesRoot, folder, threadIdStr, `${filenameBase}.processed.json`);
        const original = path.join(messagesRoot, folder, threadIdStr, `${filenameBase}.json`);

        try {
          await fs.access(processed);
          msgPath = processed;
          break;
        } catch {}

        try {
          await fs.access(original);
          msgPath = original;
          break;
        } catch {}
      }
    }

    if (!msgPath) {
      return res.status(404).json({ error: 'Message file not found' });
    }

    try {
      const fileContents = await fs.readFile(msgPath, 'utf8');
      const data = JSON.parse(fileContents);

      const fixedData = data as unknown as FacebookData;

      // Inject is_sender for Facebook messages
      if (fixedData.messages && Array.isArray(fixedData.messages)) {
        fixedData.messages.forEach((m) => {
          m.is_sender = myNames.includes(m.sender_name);
        });
      }

      return res.status(200).json(fixedData);
    } catch (e) {
      console.error('Error reading message file:', e);
      return res.status(500).json({ error: 'Failed to load messages' });
    }
  }

  return res.status(400).json({ error: 'Invalid platform' });
}
