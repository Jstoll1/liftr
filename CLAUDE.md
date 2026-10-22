# Working notes for Claude

## Design review before every push: BAD
Nothing ships (button, menu, strip, card, pop up) until it passes BAD at
phone width (390px) and, for shared pages, desktop width:

- **Balance**: weight spread evenly; no lone element floating in a big box,
  no heavy side and empty side.
- **Alignment**: text, icons and buttons share edges and centre lines; a
  header and its button sit on one row; lists line up in columns.
- **Deadspace**: no empty bands or padding with nothing in it; nothing
  wraps onto its own line leaving a gap; cards hug their content.

Screenshot the real component (every state: closed, open, empty, long text)
and look at it before committing. If it fails BAD, fix it first.
