// Secret-stripping patterns applied to every outbound Discord post body.
// Each pattern is replaced with a <TYPE>_*** mask so secrets never reach Discord.

interface Pattern {
  name: string;
  regex: RegExp;
  mask: string;
}

const PATTERNS: Pattern[] = [
  // Paperclip API key
  { name: "PAPERCLIP_KEY", regex: /pcp_[A-Za-z0-9]{20,}/g, mask: "PAPERCLIP_KEY_***" },
  // GitHub PAT classic
  { name: "GITHUB_PAT", regex: /ghp_[A-Za-z0-9]{36}/g, mask: "GITHUB_PAT_***" },
  // GitHub PAT new format
  { name: "GITHUB_PAT_NEW", regex: /github_pat_[A-Za-z0-9_]{40,}/g, mask: "GITHUB_PAT_NEW_***" },
  // Discord bot token: base64.6chars.27+chars
  {
    name: "DISCORD_BOT_TOKEN",
    regex: /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,
    mask: "DISCORD_BOT_TOKEN_***",
  },
  // AWS access key ID
  { name: "AWS_ACCESS_KEY", regex: /AKIA[0-9A-Z]{16}/g, mask: "AWS_ACCESS_KEY_***" },
  // Slack bot token
  { name: "SLACK_BOT_TOKEN", regex: /xoxb-[0-9A-Za-z-]{40,}/g, mask: "SLACK_BOT_TOKEN_***" },
  // Bailian sk-cp- format
  { name: "BAILIAN_KEY", regex: /sk-cp-[A-Za-z0-9_-]{20,}/g, mask: "BAILIAN_KEY_***" },
  // Bailian sk-sp- format
  { name: "BAILIAN_KEY", regex: /sk-sp-[A-Za-z0-9_-]{20,}/g, mask: "BAILIAN_KEY_***" },
];

export function stripSecrets(text: string): string {
  let result = text;
  for (const p of PATTERNS) {
    result = result.replace(p.regex, p.mask);
  }
  return result;
}
