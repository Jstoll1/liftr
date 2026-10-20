// The Creative Studio's categories. Each entry says what a graphic is, what
// it is about (its subject), where it would appear, how to ask for it, and
// what it may cost; the Studio draws its screens from this list, so a new
// kind of graphic is a new entry here and nothing else.
//
// Every prompt forbids text: names, scores and standings are drawn by the
// app over the art, never generated inside it.

const NO_TEXT = "Absolutely no text, letters, numbers, words, wordmarks or logos anywhere in the image.";
// No people: never a real person, an ethnic group or a cultural caricature.
// A team named for a people or a nation gets a symbol instead.
const NO_PEOPLE = "Never depict a real person, a human ethnic group, Native American people, headdresses or any cultural caricature. If the team is named for a people, a nation or a person (for example Seminoles, Fighting Irish, Aggies, Cavaliers), show an object or animal symbol instead, such as a flaming spear, a shamrock, a horse or a crossed sabre.";
const ARCADE = "16-bit retro arcade pixel art, bold black outline, neon rim light, sticker style, centered on a transparent background";

// gpt-image-1 at 1024x1024: image tokens by quality, priced per OpenAI's
// published rates ($40 per million image output tokens, $5 per million text
// input tokens). An estimate for the card; the real cost comes back with
// each image.
export const IMAGE_TOKENS = { low: 272, medium: 1056, high: 4160 };
export const PRICE = { textIn: 5 / 1e6, imageIn: 10 / 1e6, imageOut: 40 / 1e6 };
export const estimateCost = (quality = "medium", promptChars = 600) => +(IMAGE_TOKENS[quality] * PRICE.imageOut + (promptChars / 4) * PRICE.textIn).toFixed(4);

const str = (v, max) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

export const TONES = { coach: "a straight-talking coach: warm, direct, practical", hype: "a hype man on game day: loud, fun, big energy", dry: "a dry, deadpan analyst: understated wit", savage: "a savage roast from a friend: ruthless but affectionate, never cruel about anything but picks" };

export const CATEGORIES = {
  "team-mascot": {
    kind: "image",
    label: "Team mascot",
    blurb: "A mascot in the arcade style, for a team's spot on the Replay and anywhere a team logo shows.",
    placements: ["replay-logo"],
    trigger: "slate",          // suggested from the slate and the Replay
    perWeek: false,            // one mascot per team, reused every week
    publishWhen: "any",        // no event to wait for
    size: "1024x1024", quality: "medium", background: "transparent",
    // The subject: one team, by its ESPN id, with what the prompt needs.
    subject(input) {
      const teamId = Number(input?.teamId);
      const name = str(input?.name, 60);
      if (!Number.isInteger(teamId) || teamId < 1 || !name) return { error: "Pick a team." };
      return { key: `team:${teamId}`, label: name, data: { teamId, name, mascot: str(input?.mascot, 40), colors: str(input?.colors, 60) } };
    },
    prompt(s) {
      const d = s.data;
      return [
        `${ARCADE}.`,
        `An original mascot or symbol for the ${d.name} college football team${d.mascot ? `, a ${d.mascot}` : ""}${d.colors ? `, in ${d.colors}` : ""}.`,
        "Head and shoulders, fierce and fun, game-day energy.",
        "An original character in the spirit of the team's mascot, not a copy of any official logo.",
        NO_PEOPLE,
        NO_TEXT,
      ].join(" ");
    },
  },
};

CATEGORIES["scouting-report"] = {
  kind: "text",
  label: "Scouting Report",
  blurb: "Each owner's report, written from their own numbers (scout.js). Pick a tone, read them all, edit any line, then publish to their leaderboard card.",
  placements: ["owner-card"],
  trigger: "manual",
  publishWhen: "any",
  perWeek: true,
  // The subject: one owner, with the facts scout.js computed for them. The
  // writer may use only these; every number in the report comes from here.
  subject(input) {
    const name = str(input?.name, 40);
    if (!name) return { error: "Pick an owner." };
    const facts = input?.facts && typeof input.facts === "object" ? input.facts : null;
    const raw = facts ? JSON.stringify(facts) : "";
    if (!facts || raw.length > 8000) return { error: "That owner's numbers are missing or too long." };
    return { key: `owner:${name}`, label: name, data: { name, facts } };
  },
  prompt(s, { tone = "coach", feedback = null, previous = null } = {}) {
    const voice = TONES[tone] || TONES.coach;
    const system = [
      "You write a short scouting report for one owner in a college football pick'em league among friends.",
      `Voice: ${voice}.`,
      "Use only the facts given. Never invent or change a number, a team, a week or a result; you may round or say a number in words.",
      "No em dashes and no hyphens used as punctuation. Plain words. Under 120 words.",
      'Return JSON: {"headline": "under 9 words", "body": "two or three short paragraphs separated by a blank line, ending with the one thing to change if there is one"}.',
    ].join(" ");
    const user = [`Owner: ${s.data.name}`, `Facts: ${JSON.stringify(s.data.facts)}`, previous ? `Revise this earlier draft: ${previous}` : "", feedback ? `Owner's note for this draft: ${feedback}` : ""].filter(Boolean).join("\n");
    return JSON.stringify({ system, user, tone });
  },
};

// The league's award and badge art: the Week Replay's card icons, the
// high score trophy and the season stats tiles. Today each is a fixed
// picture in assets/images; a published one takes its place. The key is
// that picture's path with a dash (recap-crown is recap/crown.webp).
export const AWARDS = {
  "recap-crown": ["Pick of the Week", "Week Replay", "a jeweled golden crown"],
  "recap-bomb": ["Worst Pick", "Week Replay", "a round black cartoon bomb with a lit fuse throwing sparks"],
  "recap-chart": ["Movement", "Week Replay", "a rising green bar chart with a bold arrow climbing up"],
  "recap-coin": ["Coin Flip", "Week Replay", "a spinning gold coin"],
  "recap-flag": ["Tiebreaker", "Week Replay", "a waving black and white checkered racing flag"],
  "recap-trophy": ["Week High Score", "High score banner", "a shining gold trophy cup"],
  "hs-ats": ["Best ATS", "Season stats", "a red and white bullseye target with an arrow in the center"],
  "hs-streak": ["Hot Hand", "Season stats", "an open hand wreathed in flames"],
  "hs-dogs": ["Dog Hits", "Season stats", "a cool dog wearing sunglasses"],
  "hs-lone": ["Lone Wolf", "Season stats", "a wolf howling at a full moon"],
  "hs-fader": ["Favorite Fader", "Season stats", "a retro synthwave sunset with palm trees"],
  "hs-tb": ["TB Sniper", "Season stats", "a glowing sniper scope crosshair"],
  "hs-best": ["Best Week", "Season stats", "a gold trophy bursting with light rays and stars"],
  "hs-blanks": ["No Shows", "Season stats", "a sleepy crescent moon among little stars"],
  "hs-bank": ["Bankroll", "Side bets", "a thick stack of green cash"],
  "hs-dice": ["Side Picks", "Side bets", "a pair of white dice mid roll"],
  "hs-coins": ["Side Bets", "Side bets", "a stack of gold coins"],
};
CATEGORIES["award-art"] = {
  kind: "image",
  label: "Award art",
  blurb: "The icons on the Week Replay cards, the high score trophy and the season stats tiles. A published one replaces today's picture.",
  placements: ["award-icon"],
  trigger: "manual",
  perWeek: false,
  publishWhen: "any",
  size: "1024x1024", quality: "medium", background: "transparent",
  choices: Object.entries(AWARDS).map(([key, [label, where]]) => ({ key, label, where })),
  subject(input) {
    const key = String(input?.award || "");
    const a = AWARDS[key];
    if (!a) return { error: "Pick an award." };
    return { key: `award:${key}`, label: `${a[0]} · ${a[1]}`, data: { award: key, name: a[0], where: a[1], motif: a[2] } };
  },
  prompt(s) {
    const d = s.data;
    return [
      `${ARCADE}.`,
      `A single bold icon: ${d.motif}.`,
      `It is the badge for the "${d.name}" award in a football pick'em game, so it must read clearly at small sizes, with a strong silhouette and few details.`,
      NO_PEOPLE,
      NO_TEXT,
    ].join(" ");
  },
};

// Any graphic or line of copy on the page, picked by tapping it in the
// Studio's Canvas. The slot is what the app calls that spot: an image's
// own path (assets/images/recap/crown.webp), a team logo (team:99) or a
// line of copy (t: and its original words). The owner's direction is the
// version's feedback, so a new idea for the same spot is a new version.
const SLOT_STYLES = {
  arcade: ARCADE,
  freeform: "Clean illustration centered on a transparent background, matching a retro arcade football app",
};
const slotOk = (v) => typeof v === "string" && /^(assets\/images\/[\w\/.-]{1,120}|team:\d{1,6}|t:[^\n]{1,100})$/.test(v);
CATEGORIES["slot-image"] = {
  kind: "image",
  label: "Canvas graphic",
  blurb: "Any graphic on the page, tapped in the Canvas, redrawn from your direction.",
  placements: ["slot"],
  trigger: "manual", perWeek: false, publishWhen: "any", hidden: true,
  size: "1024x1024", quality: "medium", background: "transparent",
  subject(input) {
    const slot = input?.slot;
    if (!slotOk(slot) || slot.startsWith("t:")) return { error: "Tap a graphic in the Canvas." };
    const style = SLOT_STYLES[input?.style] ? input.style : "arcade";
    return { key: `img:${slot}`, label: str(input?.label, 80) || slot, data: { slot, style, what: str(input?.label, 80) } };
  },
  prompt(s) {
    const d = s.data;
    return [
      `${SLOT_STYLES[d.style] || ARCADE}.`,
      d.what ? `It replaces the "${d.what}" graphic in the app, so it must read clearly at small sizes.` : "It must read clearly at small sizes.",
      NO_PEOPLE,
      NO_TEXT,
    ].join(" ");
  },
};
CATEGORIES["slot-text"] = {
  kind: "text",
  label: "Canvas copy",
  blurb: "Any heading or label on the page, tapped in the Canvas, rewritten by you or the writer.",
  placements: ["slot"],
  trigger: "manual", perWeek: false, publishWhen: "any", hidden: true, bodyOnly: true,
  subject(input) {
    const slot = input?.slot;
    if (!slotOk(slot) || !slot.startsWith("t:")) return { error: "Tap a line of copy in the Canvas." };
    return { key: slot, label: slot.slice(2), data: { slot, current: slot.slice(2) } };
  },
  prompt(s, { tone = "hype", feedback = null, previous = null } = {}) {
    const cur = s.data.current;
    const system = [
      "You rewrite one short piece of interface copy in a retro arcade college football pick'em app among friends.",
      `Voice: ${TONES[tone] || TONES.hype}.`,
      `Keep it about as long as the original (at most ${Math.max(12, Math.round(cur.length * 1.6))} characters) and in the same case style.`,
      "Never add numbers, scores, records, team or player names. No em dashes and no hyphens used as punctuation.",
      'Return JSON: {"body": "the new copy"}.',
    ].join(" ");
    const user = [`Original: ${cur}`, previous ? `Earlier draft: ${previous}` : "", feedback ? `Owner's direction: ${feedback}` : ""].filter(Boolean).join("\n");
    return JSON.stringify({ system, user, tone });
  },
};

export const MAX_FEEDBACK = 500;

// What the Studio needs to draw its pickers, without the prompt code.
export function publicTypes() {
  return Object.entries(CATEGORIES).map(([id, c]) => ({ id, kind: c.kind || "image", label: c.label, blurb: c.blurb, placements: c.placements, trigger: c.trigger, publishWhen: c.publishWhen, perWeek: c.perWeek !== false, ...(c.choices ? { choices: c.choices } : {}), ...(c.hidden ? { hidden: true } : {}), estCost: c.kind === "text" ? 0.006 : estimateCost(c.quality) }));
}
