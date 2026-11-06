This work includes material taken from the System Reference Document 5.1
("SRD 5.1") by Wizards of the Coast LLC, available at
https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
licensed under the Creative Commons Attribution 4.0 International License,
available at https://creativecommons.org/licenses/by/4.0/legalcode.

Where that material lives:

- `spells.json` and `skills.json`: the SRD 5.1 spells and skills. The data
  (English spells, English and Russian skills) was sourced from the
  [5e-database](https://github.com/5e-bits/5e-database) project and trimmed to
  the fields this app uses.
- `monsters.ts` (the bestiary), the magic items in `../character/magic-items.ts`
  and the weapon and gear lists. The monster statistics were transcribed by hand
  and checked for internal consistency by `packages/domain/world/bestiary.test.ts`.

The Russian names and texts are our own translation and are not official Wizards
of the Coast text. `spells.ru.json` translates the spell texts of the SRD 5.1
(all 319 spells, completed 19 October 2026); it is a modified version of that
material. Spell names follow the established Russian terms as listed on dnd.su;
spells whose SRD names omit the wizard's name keep it omitted. The descriptions
themselves are translated from the SRD, not taken from any other translation.
