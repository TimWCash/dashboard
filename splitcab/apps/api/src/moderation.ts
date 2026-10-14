// Chat between strangers needs a basic filter (App Store guideline 1.2): no links, no abusive language.
// Reports and blocking cover the rest. Extend the list with BLOCKED_TERMS (comma-separated).

const BUILT_IN = ['fuck', 'fucking', 'cunt', 'bitch', 'whore', 'slut', 'retard', 'faggot', 'nigger', 'paki', 'tinker', 'knacker'];

// Links in chat are mostly scams ("pay me here"). Phone numbers are fine: people use them to meet up.
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|ie|io|ly|me|app|link|co|info|xyz)(?:\/\S*)?\b/i;

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function normalise(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$!]/g, (ch) => LEET[ch] ?? ch);
}

export type ModerationResult = { ok: true } | { ok: false; reason: 'link' | 'abusive' };

export function createModerator(extraTerms: string[] = []) {
  const terms = [...BUILT_IN, ...extraTerms.map((t) => t.trim().toLowerCase()).filter(Boolean)];
  const pattern = new RegExp(`\\b(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  return (text: string): ModerationResult => {
    if (LINK.test(text)) return { ok: false, reason: 'link' };
    if (pattern.test(normalise(text))) return { ok: false, reason: 'abusive' };
    return { ok: true };
  };
}
