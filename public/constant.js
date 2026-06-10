export const DEFAULT_MCP_SERVERS = [
  { "name": "github", "url": "https://api.githubcopilot.com/mcp", "configType": "oauth" },
];

export const GITHUB_CLIENT_ID = 'Iv23liL6wh9gTPmGbD83';
export const GITHUB_APP_SLUG = 'bingwuai';

export const APP_MODELS = [
  {
    "name": "Gemini 3.1 Flash Preview",
    "value": "gemini-3.1-flash-preview"
  },
  {
    "name": "Gemini 2.5 Flash Preview",
    "value": "gemini-2.5-flash-preview"
  }
];

export const APP_VOICES = [
  {
    "name": "No Voice",
    "characteristics": "Default"
  },
  {
    "name": "Zephyr",
    "characteristics": "Bright, Higher pitch"
  },
  {
    "name": "Puck",
    "characteristics": "Upbeat, Middle pitch"
  },
  {
    "name": "Charon",
    "characteristics": "Informative, Lower pitch"
  },
  {
    "name": "Kore",
    "characteristics": "Firm, Middle pitch"
  },
  {
    "name": "Fenrir",
    "characteristics": "Excitable, Lower middle pitch"
  },
  {
    "name": "Leda",
    "characteristics": "Youthful, Higher pitch"
  },
  {
    "name": "Orus",
    "characteristics": "Firm, Lower middle pitch"
  },
  {
    "name": "Aoede",
    "characteristics": "Breezy, Middle pitch"
  },
  {
    "name": "Callirrhoe",
    "characteristics": "Easy-going, Middle pitch"
  },
  {
    "name": "Autonoe",
    "characteristics": "Bright, Middle pitch"
  },
  {
    "name": "Enceladus",
    "characteristics": "Breathy, Lower pitch"
  },
  {
    "name": "Iapetus",
    "characteristics": "Clear, Lower middle pitch"
  },
  {
    "name": "Umbriel",
    "characteristics": "Easy-going, Lower middle pitch"
  },
  {
    "name": "Algieba",
    "characteristics": "Smooth, Lower pitch"
  },
  {
    "name": "Despina",
    "characteristics": "Smooth, Middle pitch"
  },
  {
    "name": "Erinome",
    "characteristics": "Clear, Middle pitch"
  },
  {
    "name": "Algenib",
    "characteristics": "Gravelly, Lower pitch"
  },
  {
    "name": "Rasalgethi",
    "characteristics": "Informative, Middle pitch"
  },
  {
    "name": "Laomedeia",
    "characteristics": "Upbeat, Higher pitch"
  },
  {
    "name": "Achernar",
    "characteristics": "Soft, Higher pitch"
  },
  {
    "name": "Alnilam",
    "characteristics": "Firm, Lower middle pitch"
  },
  {
    "name": "Schedar",
    "characteristics": "Even, Lower middle pitch"
  },
  {
    "name": "Gacrux",
    "characteristics": "Mature, Middle pitch"
  },
  {
    "name": "Pulcherrima",
    "characteristics": "Forward, Middle pitch"
  },
  {
    "name": "Achird",
    "characteristics": "Friendly, Lower middle pitch"
  },
  {
    "name": "Zubenelgenubi",
    "characteristics": "Casual, Lower middle pitch"
  },
  {
    "name": "Vindemiatrix",
    "characteristics": "Gentle, Middle pitch"
  },
  {
    "name": "Sadachbia",
    "characteristics": "Lively, Lower pitch"
  },
  {
    "name": "Sadaltager",
    "characteristics": "Knowledgeable, Middle pitch"
  },
  {
    "name": "Sulafat",
    "characteristics": "Warm, Middle pitch"
  }
];

export const DEFAULT_ROLES = [
  {
    id: "role-gemili-audio-chat",
    name: "BingwuAI 语音对话",
    voiceName: "Kore",
    autoLoadTools: 'get_weather,renderPage,urlContext,imageGeneration,imageEditing,fetch,codeExecution,web_search,checkDomainAvailability,musicPlaylist,github__get_me,github__search_repositories,github__get_file_contents,github__search_code,github__search_issues,github__issue_read',
    systemInstruction: "You are a concise, friendly Chinese voice assistant."
  },
  {
    id: 'role-github-note',
    name: 'GitHub笔记助手',
    voiceName: 'Orus',
    autoLoadTools: 'web_search,github__add_issue_comment,github__create_or_update_file,github__get_commit,github__delete_file,github__get_me,github__search_code,github__search_commits,github__search_issues,github__issue_read,github__search_repositories,github__list_commits,github__issue_write,github__get_file_contents',
    systemInstruction: `You are a concise, friendly Chinese voice assistant.
你的职责是, 根据用户指令内容操作用户的GitHub({github name})的{repo name}仓库.
## 指令
记: 表示需要把用户的内容写到{repo name}仓库, 如果用户没有指定目录或文件, 则, 先查找仓库目录和文件列表, 再根据用户内容, 查找最符合情况的目录或文件写入. 如果指定文件已存在或有内容, 则追加内容.
读: 表示用户需要读取{repo name}仓库里的内容, 如果用户没有指定目录或文件, 则, 先查找仓库目录和文件列表, 再根据用户内容, 查找最符合情况的目录或文件读取.`,
  },
  {
    id: 'role-translator',
    name: '翻译官',
    voiceName: 'Iapetus',
    autoLoadTools: 'urlContext',
    systemInstruction: '你是一位专业翻译官。默认直接执行中英互译：用户输入中文就翻译成自然英文，用户输入英文就译成准确中文; 翻译完成后, 必须给出其中最难(考试)的1个单词的解释, 含音标, 释义和示例；如果用户给出特定语言、风格、领域、格式或解释要求，优先遵守用户指令。翻译要忠实、流畅、符合语境，可在必要时简短说明关键词、语气或多种译法。除非用户要求，不添加无关扩写, 不参与任何讨论。',
  },
];
