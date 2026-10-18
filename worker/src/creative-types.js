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

export const CATEGORIES = {
  "team-mascot": {
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

export const MAX_FEEDBACK = 300;

// What the Studio needs to draw its pickers, without the prompt code.
export function publicTypes() {
  return Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, blurb: c.blurb, placements: c.placements, trigger: c.trigger, publishWhen: c.publishWhen, estCost: estimateCost(c.quality) }));
}
