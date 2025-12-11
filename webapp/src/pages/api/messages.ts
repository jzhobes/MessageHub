import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

// Google Chat type definitions
interface GoogleChatAttachedFile {
  export_name: string;
}

interface GoogleChatReaction {
  emoji: {
    unicode: string;
  };
  reactor_emails?: string[];
}

interface GoogleChatCreator {
  name: string;
}

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

interface GoogleChatData {
  messages: GoogleChatMessage[];
}

interface MediaItem {
  uri: string;
}

interface FacebookMessage {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  is_sender?: boolean;
  photos?: MediaItem[];
  videos?: MediaItem[];
  reactions?: { reaction: string; actor: string }[];
}

interface FacebookData {
  messages: FacebookMessage[];
  [key: string]: unknown;
}

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

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { threadId, page = '1', platform } = req.query;

  if (!threadId) {
    return res.status(400).json({ error: 'Missing threadId' });
  }

  const threadIdStr = Array.isArray(threadId) ? threadId[0] : threadId;
  const pageStr = Array.isArray(page) ? page[0] : page;
  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  // Identify "Me"
  const myNamesSet = new Set<string>();
  const profileSources = [
    {
      path: path.join(process.cwd(), '../data/Facebook/profile_information/profile_information.json'),
      extract: (data: FacebookProfile) => data?.profile_v2?.name?.full_name,
    },
    {
      path: path.join(process.cwd(), '../data/Instagram/personal_information/personal_information.json'),
      extract: (data: InstagramProfile) => data?.profile_user?.[0]?.string_map_data?.Name?.value,
    },
    {
      path: path.join(process.cwd(), '../data/Google Chat/Users/User 100858821545879890647/user_info.json'),
      extract: (data: GoogleChatUserInfo) => data?.user?.name,
    },
  ];

  for (const source of profileSources) {
    try {
      if (fs.existsSync(source.path)) {
        const fileData = JSON.parse(fs.readFileSync(source.path, 'utf8'));
        const foundName = source.extract(fileData);
        if (foundName) {
          myNamesSet.add(foundName);
        }
      }
    } catch (e) {
      console.error(`Failed to load profile info from ${source.path}`, e);
    }
  }
  const myNames = Array.from(myNamesSet);

  // Google Chat Handling
  if (platformStr === 'Google Chat') {
    const inboxPath = path.join(process.cwd(), '../data/Google Chat/Groups');
    const msgPath = path.join(inboxPath, threadIdStr, `message_${pageStr}.json`);

    console.log(`[Google Chat] Loading messages from: ${msgPath}`);
    try {
      if (!fs.existsSync(msgPath)) {
        console.error(`[Google Chat] File not found: ${msgPath}`);
        return res.status(404).json({ error: 'Message file not found' });
      }
      const data: GoogleChatData = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
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
            actor: email, // display email as actor for now; usually no name in this part of export
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

        // If neither (e.g. unsupported attachment only), keep original behavior (empty text/media) to avoid data loss?
        // But original would show an empty bubble.
        // If result is empty, let's create a placeholder if it originally existed?
        // Actually, if m.text is empty string and no photos, original code returned object with empty content.
        // Let's replicate that if both ignored.
        if (result.length === 0) {
          // Fallback to empty text message to behave like before (or could be unsupported file)
          result.push({
            sender_name: sender,
            timestamp_ms: ms,
            content: m.text || '', // likely empty string
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
      const messagesRoot = path.join(process.cwd(), '../data/Instagram/your_instagram_activity/messages/inbox');
      const candidatePath = path.join(messagesRoot, threadIdStr, `message_${pageStr}.json`);
      if (fs.existsSync(candidatePath)) {
        msgPath = candidatePath;
      }
    } else {
      // Facebook
      const messagesRoot = path.join(process.cwd(), '../data/Facebook/your_facebook_activity/messages');
      const foldersToSearch = ['inbox', 'archived_threads', 'legacy_threads', 'e2ee_cutover'];

      // Try to find the thread in each folder
      for (const folder of foldersToSearch) {
        const candidatePath = path.join(messagesRoot, folder, threadIdStr, `message_${pageStr}.json`);
        if (fs.existsSync(candidatePath)) {
          msgPath = candidatePath;
          break;
        }
      }
    }

    if (!msgPath) {
      return res.status(404).json({ error: 'Message file not found' });
    }

    try {
      const fileContents = fs.readFileSync(msgPath, 'utf8');
      const data = JSON.parse(fileContents);

      // Type for arbitrary JSON values
      type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

      // Facebook exports use Latin-1 encoding instead of UTF-8, causing emoji and special characters to be corrupted.
      // This function recursively walks the entire JSON structure and fixes all string values.
      const fixString = (str: string) => {
        try {
          let decoded = Buffer.from(str, 'latin1').toString('utf8');
          decoded = decoded.replace(/\u2764(?!\uFE0F)/g, '\u2764\uFE0F');
          return decoded;
        } catch {
          return str;
        }
      };

      const fixEncodingRecursive = (obj: JsonValue): JsonValue => {
        if (typeof obj === 'string') {
          return fixString(obj);
        } else if (Array.isArray(obj)) {
          return obj.map(fixEncodingRecursive);
        } else if (obj && typeof obj === 'object') {
          const newObj: { [key: string]: JsonValue } = {};
          for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
              newObj[key] = fixEncodingRecursive(obj[key]);
            }
          }
          return newObj;
        }
        return obj;
      };

      const fixedData = fixEncodingRecursive(data) as unknown as FacebookData;

      // Inject is_sender for Facebook messages
      if (fixedData.messages && Array.isArray(fixedData.messages)) {
        fixedData.messages.forEach((m) => {
          m.is_sender = myNames.includes(m.sender_name);
        });
      }

      return res.status(200).json(fixedData);
    } catch (error) {
      console.error('Error reading message file:', error);
      return res.status(500).json({ error: 'Failed to load messages' });
    }
  }

  return res.status(400).json({ error: 'Invalid platform' });
}
