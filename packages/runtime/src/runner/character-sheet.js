/**
 * The character sheet: the model behind a screen where a player configures their own delver.
 *
 * It holds the choices and the cursor and nothing else. What a choice costs is the Allocator's
 * (`pricing.quoteActor`); what is allowed (kinds, expressions, motivations, the viability floor,
 * slot limits) is read from the shared constants. The sheet turns a screen's keys into edits
 * (`apply`), describes what to draw (`view`), and writes the result as the same `--delver` spec
 * `ak create` takes (`spec`), so the level is still authored and priced by the personas.
 *
 * A terminal, a browser page and a phone all draw `view()` and send the same intents.
 * The sheet is built for a delver; the row builders take the actor kind so wardens, hazards and
 * resources can add theirs.
 */
import { AFFINITY_EXPRESSIONS, AFFINITY_KINDS, ACTOR_VIABILITY_FLOOR, PRESET_AFFINITY_SLOTS } from "../contracts/domain-constants.js";
import { GAME_VITAL_KEYS } from "../contracts/game-elements.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { MAX_AFFINITY_SLOTS } from "../../../core-ts/src/state/actor-inventory.ts";
import { affinityUpkeepIndex, isLastingAffinityExpression } from "../../../core-ts/src/rules/actor-upkeep.ts";

export const SHEET_INTENT = Object.freeze({
  UP: "up", DOWN: "down", LEFT: "left", RIGHT: "right",
  INC: "inc", DEC: "dec", INC_BIG: "incBig", DEC_BIG: "decBig",
  CLEAR_SLOT: "clearSlot", RESET: "reset", CONFIRM: "confirm", CANCEL: "cancel",
});

const BIG_STEP = 5;
// Every slot you hold starts equipped (Darren, 2026-10-29): emits are on, casts are ready.
export const SLOT_FIELDS = Object.freeze(["kind", "expression", "range", "intensity"]);
export const VITAL_FIELDS = Object.freeze(["max", "regen"]);
export const MINION_FIELDS = Object.freeze(["role"]);
/** Fields that hold a number (− and + change them); the rest are choices a tap steps through. */
export const NUMERIC_FIELDS = Object.freeze(["range", "intensity", "max", "regen"]);
/** What a slot's kind can be set to: no affinity, or any kind (none of them is a default). */
export const SLOT_KIND_CHOICES = Object.freeze(["none", ...AFFINITY_KINDS]);

// An empty slot still shows its other fields, at these values, ready for a kind to be chosen.
const blankSlot = () => ({ kind: null, expression: AFFINITY_EXPRESSIONS[0], range: 1, intensity: 1 });
const held = (slot) => Boolean(slot?.kind);

function cycle(list, current, step) {
  const at = Math.max(0, list.indexOf(current));
  return list[(at + step + list.length * 4) % list.length];
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** The tuples of a `--delver` spec's `affinities=`, `equip=`, `vitals=`, `slots=` and `minions=` fields. */
export function sheetChoicesFromSpec(spec) {
  const fields = new Map();
  String(spec || "").split(";").forEach((segment) => {
    const at = segment.indexOf("=");
    if (at > 0) fields.set(segment.slice(0, at).trim().toLowerCase(), segment.slice(at + 1).trim());
  });
  const slots = [];
  String(fields.get("affinities") || "").split(",").filter(Boolean).forEach((entry) => {
    const [kind, expression, range, intensity] = entry.split(":");
    slots.push({ kind, expression, range: Number(range) || 1, intensity: Number(intensity) || 1 });
  });
  const vitals = {};
  GAME_VITAL_KEYS.forEach((key) => { vitals[key] = { max: ACTOR_VIABILITY_FLOOR[key]?.max ?? 10, regen: ACTOR_VIABILITY_FLOOR[key]?.regen ?? 1 }; });
  String(fields.get("vitals") || "").split(",").filter(Boolean).forEach((entry) => {
    const parts = entry.split(":");
    const key = parts[0];
    if (!vitals[key]) return;
    const numbers = parts.slice(1).map(Number);
    vitals[key] = numbers.length >= 3 ? { max: numbers[1], regen: numbers[2] } : { max: numbers[0], regen: numbers[1] };
  });
  const slotCount = Math.max(Number(fields.get("slots")) || 0, PRESET_AFFINITY_SLOTS.delver, slots.length);
  const minions = String(fields.get("minions") || "").split("+").map((role) => role.trim()).filter(Boolean);
  return { slots, vitals, slotCount, minions };
}

/** The caller's figure, else the delver pool of the Allocator's reference budget. */
function allowanceFor(requested, allocator) {
  if (Number.isFinite(requested)) return requested;
  const reference = allocator.pricing.levelAuthoring().referenceBudgetTokens;
  return allocator.pricing.budgetPools({ budgetTokens: reference }).pools.find((pool) => pool.id === "delver").tokens;
}

/**
 * @param {{ spec?: string, budgetTokens?: number, id?: string }} options
 *   `spec` is the starting character (a scenario's own delver, `minions=` included); `budgetTokens`
 *   is what the Allocator allots this character and its minions (the delver pool of the level it
 *   joins); `id` is the actor id written into the spec.
 */
export function createCharacterSheet({ spec = "", budgetTokens: requested, id = "hero" } = {}) {
  const configurator = createConfiguratorPersona({ clock: UNUSED_CLOCK });
  const allocator = createAllocatorPersona({ clock: UNUSED_CLOCK, normalizeMotivations: configurator.normalizeMotivations });
  // What the Allocator allots a delver: the caller's figure (a level's own delver pool), else the
  // delver pool of the Allocator's reference budget. Never "no limit".
  const allowance = allowanceFor(requested, allocator);
  const roleChoices = ["none", ...configurator.retinueRoles()];
  const parsed = sheetChoicesFromSpec(spec);
  const initial = { ...parsed, minions: parsed.minions.filter((role) => roleChoices.includes(role) && role !== "none") };
  let choices = clone(initial);
  const cursor = { row: 0, field: 0 };

  // Every slot a delver could have is a row; one set to none is not bought. The first
  // PRESET_AFFINITY_SLOTS.delver come with the delver, and the Allocator prices each one past that.
  const slotRows = () => Array.from({ length: MAX_AFFINITY_SLOTS }, (_, index) => ({ kind: "slot", index }));
  const slotsBought = () => Math.max(PRESET_AFFINITY_SLOTS.delver, choices.slots.filter(held).length);
  // Minions: each one picked so far, then one more row (set to none) to add another. The
  // allowance is the only limit.
  const minionRows = () => Array.from({ length: choices.minions.length + 1 }, (_, index) => ({ kind: "minion", index }));
  const rows = () => [...slotRows(), ...GAME_VITAL_KEYS.map((key) => ({ kind: "vital", key })), ...minionRows()];
  const fieldsOf = (row) => (row.kind === "slot" ? SLOT_FIELDS : row.kind === "minion" ? MINION_FIELDS : VITAL_FIELDS);

  // What a held slot spends in mana, as core charges it: an emit or draw pays the Configurator's
  // upkeep at range + intensity² every tick it is on; a push or pull pays its cast price
  // (base × intensity² × r(r+1)/2) each time it is cast.
  function manaCost(slot) {
    if (isLastingAffinityExpression(slot.expression)) {
      return { amount: configurator.computeInternalManaUpkeep(affinityUpkeepIndex(slot.range, slot.intensity)), per: "tick" };
    }
    const amount = configurator.resolveAffinityManaCost({ kind: slot.kind, expression: slot.expression, stacks: slot.range, intensity: slot.intensity });
    return Number.isFinite(amount) ? { amount, per: "cast" } : null;
  }
  // Above max mana it can never be paid: an emit stays off, a cast is never made.
  const withReach = (mana) => (mana ? { ...mana, overMax: mana.amount > choices.vitals.mana.max } : null);

  // How far a tap takes a held slot's range or intensity before it loops back to 1 (Darren,
  // 2026-10-30). Core caps neither; what stops them in play is mana (core never pays a cost above
  // max mana, so a larger value is never cast or never stays on) and the allowance. The limit is
  // the largest value whose mana still fits max mana and whose total still fits the allowance.
  const TAP_CEILING = 99;
  function tapLimit(index, name) {
    const slot = choices.slots[index];
    if (!held(slot)) return 1;
    const kept = slot[name];
    let limit = 1;
    for (let value = 2; value <= TAP_CEILING; value += 1) {
      slot[name] = value;
      const mana = manaCost(slot);
      if (!mana || mana.amount > choices.vitals.mana.max || spent() > allowance) break;
      limit = value;
    }
    slot[name] = kept;
    return limit;
  }

  // The minions as the build composes them (the Configurator's retinue for this delver), so the
  // sheet prices exactly what `ak create` adds.
  function composedMinions() {
    if (choices.minions.length === 0) return { minions: [], roles: [], notes: [] };
    const owned = choices.slots.filter(held);
    const equipped = owned[0];
    const leader = {
      id: `${id}-1`,
      category: "delver",
      defeatVital: "health",
      motivations: ["user_controlled"],
      affinities: owned.map((slot) => ({ kind: slot.kind, expression: slot.expression, stacks: slot.range, intensity: slot.intensity })),
      ...(equipped ? { activeAffinityKey: `${equipped.kind}:${equipped.expression}` } : {}),
    };
    return configurator.composeRetinue({ leader, size: choices.minions.length, roles: choices.minions, category: "delver" });
  }

  function minionQuote(minion) {
    const vitals = {};
    Object.entries(minion.vitals).forEach(([key, vital]) => { vitals[key] = { max: vital.max, regen: vital.regen }; });
    return allocator.pricing.quoteActor({ type: "delver", vitals, affinities: minion.affinities, affinitySlots: 1, motivations: minion.motivations });
  }

  function entry() {
    const vitals = {};
    GAME_VITAL_KEYS.forEach((key) => { vitals[key] = { ...choices.vitals[key] }; });
    return {
      type: "delver",
      vitals,
      affinities: choices.slots.filter(held).map((slot) => ({ kind: slot.kind, expression: slot.expression, stacks: slot.range, intensity: slot.intensity })),
      affinitySlots: slotsBought(),
      motivations: ["user_controlled"],
    };
  }

  function priced() {
    const quote = allocator.pricing.quoteActor(entry());
    const items = quote.detail?.lineItems ?? [];
    const price = (label) => items.find((item) => item.label === label)?.spendTokens ?? 0;
    const affinityItems = items.filter((item) => item.category === "affinity");
    const filled = choices.slots.map((slot, index) => (held(slot) ? index : -1)).filter((index) => index >= 0);
    return {
      quote,
      motivation: price("motivation:user_controlled"),
      slotsExtra: items.filter((item) => item.category === "affinity_slot").reduce((sum, item) => sum + item.spendTokens, 0),
      slot: (index) => affinityItems[filled.indexOf(index)]?.spendTokens ?? 0,
      vital: (key, field) => price(`${key} ${field}`),
    };
  }

  function problems(total, retinue) {
    const found = [];
    retinue.notes.forEach((note) => found.push(`Minions: ${note}.`));
    const seen = new Set();
    choices.slots.filter(held).forEach((slot) => {
      const key = `${slot.kind} ${slot.expression}`;
      if (seen.has(key)) found.push(`${key} is held twice; change one slot.`);
      seen.add(key);
    });
    Object.entries(ACTOR_VIABILITY_FLOOR).forEach(([key, floor]) => {
      const vital = choices.vitals[key];
      if (vital.max < floor.max || vital.regen < floor.regen) found.push(`${key} needs max ${floor.max}+ and regen ${floor.regen}+.`);
    });
    if (total > allowance) found.push(`${total - allowance} tokens over the allowance.`);
    return found;
  }

  // What the character and its minions cost together.
  function spent() {
    return priced().quote.cost + composedMinions().minions.reduce((sum, minion) => sum + minionQuote(minion).cost, 0);
  }

  function view() {
    const cost = priced();
    const retinue = composedMinions();
    const minionPrices = retinue.minions.map((minion) => minionQuote(minion).cost);
    const total = cost.quote.cost + minionPrices.reduce((sum, price) => sum + price, 0);
    // Which composed minion each picked role became: the retinue keeps the order and leaves out
    // a role this delver cannot fill.
    const composedAt = [];
    let next = 0;
    choices.minions.forEach((role, index) => {
      if (retinue.roles[next]?.role === role) { composedAt[index] = next; next += 1; }
    });
    const list = rows().map((row, rowIndex) => {
      const active = rowIndex === cursor.row;
      if (row.kind === "slot") {
        const slot = choices.slots[row.index] ?? blankSlot();
        return {
          id: `slot-${row.index + 1}`, kind: "slot", label: `${row.index + 1}`, active, empty: !held(slot),
          fields: [
            { name: "kind", value: slot.kind ?? "none" }, { name: "expression", value: slot.expression },
            { name: "range", value: slot.range, ...(held(slot) ? { limit: tapLimit(row.index, "range") } : {}) },
            { name: "intensity", value: slot.intensity, ...(held(slot) ? { limit: tapLimit(row.index, "intensity") } : {}) },
          ],
          // A guide, not a price: the mana the slot spends, per tick while on or per cast.
          mana: held(slot) ? withReach(manaCost(slot)) : null,
          price: held(slot) ? cost.slot(row.index) : 0,
        };
      }
      if (row.kind === "minion") {
        const role = choices.minions[row.index] ?? "none";
        const at = composedAt[row.index] ?? -1;
        const affinity = at >= 0 ? retinue.minions[at].affinities?.[0] : null;
        return {
          id: `minion-${row.index + 1}`, kind: "minion", label: `${row.index + 1}`, active, empty: role === "none",
          fields: [{ name: "role", value: role }],
          loadout: affinity ? `${affinity.kind} ${affinity.expression} r${affinity.stacks}` : null,
          price: at >= 0 ? minionPrices[at] : 0,
        };
      }
      const vital = choices.vitals[row.key];
      return {
        id: `vital-${row.key}`, kind: "vital", label: row.key, active,
        fields: [{ name: "max", value: vital.max }, { name: "regen", value: vital.regen }],
        price: cost.vital(row.key, "max") + cost.vital(row.key, "regen"),
      };
    });
    const found = problems(total, retinue);
    return {
      rows: list,
      cursor: { ...cursor },
      // Whether − and + mean anything for the field under the cursor.
      cursorNumeric: NUMERIC_FIELDS.includes(fieldsOf(rows()[cursor.row])[cursor.field]),
      motivation: { name: "user_controlled", price: cost.motivation },
      // What every emit and draw costs together each tick, against the mana regen bought.
      manaPerTick: list.reduce((sum, row) => sum + (row.mana?.per === "tick" ? row.mana.amount : 0), 0),
      slotsExtraPrice: cost.slotsExtra,
      total,
      allowance,
      remaining: allowance - total,
      problems: found.concat(cost.quote.errors ?? []),
      ok: found.length === 0 && !cost.quote.errors,
      slotCount: slotsBought(),
      freeSlots: PRESET_AFFINITY_SLOTS.delver,
      maxSlots: MAX_AFFINITY_SLOTS,
      choices: { kind: SLOT_KIND_CHOICES, expression: AFFINITY_EXPRESSIONS, role: roleChoices },
      minions: [...choices.minions],
    };
  }

  function slotAt(index) {
    choices.slots[index] = choices.slots[index] ?? blankSlot();
    return choices.slots[index];
  }
  const kindOf = (choice) => (choice === "none" ? null : choice);

  function change(step) {
    const row = rows()[cursor.row];
    const name = fieldsOf(row)[cursor.field];
    if (row.kind === "vital") {
      const vital = choices.vitals[row.key];
      vital[name] = Math.max(name === "max" ? 1 : 0, vital[name] + step);
      return;
    }
    if (row.kind === "minion") {
      const next = cycle(roleChoices, choices.minions[row.index] ?? "none", Math.sign(step));
      // none takes the minion out; the rest close up.
      if (next === "none") choices.minions.splice(row.index, 1);
      else choices.minions[row.index] = next;
      cursor.row = Math.min(cursor.row, rows().length - 1);
      return;
    }
    const slot = slotAt(row.index);
    const sign = Math.sign(step);
    if (name === "kind") slot.kind = kindOf(cycle(SLOT_KIND_CHOICES, slot.kind ?? "none", sign));
    else if (name === "expression") slot.expression = cycle(AFFINITY_EXPRESSIONS, slot.expression, sign);
    else slot[name] = Math.max(1, slot[name] + step);
  }

  function apply(intent) {
    const all = rows();
    switch (intent) {
      case SHEET_INTENT.UP: cursor.row = (cursor.row + all.length - 1) % all.length; break;
      case SHEET_INTENT.DOWN: cursor.row = (cursor.row + 1) % all.length; break;
      case SHEET_INTENT.LEFT: case SHEET_INTENT.RIGHT: {
        const fields = fieldsOf(all[cursor.row]);
        cursor.field = (cursor.field + (intent === SHEET_INTENT.RIGHT ? 1 : fields.length - 1)) % fields.length;
        break;
      }
      case SHEET_INTENT.INC: change(1); break;
      case SHEET_INTENT.DEC: change(-1); break;
      case SHEET_INTENT.INC_BIG: change(BIG_STEP); break;
      case SHEET_INTENT.DEC_BIG: change(-BIG_STEP); break;
      case SHEET_INTENT.CLEAR_SLOT: {
        const row = all[cursor.row];
        if (row.kind === "slot") choices.slots[row.index] = blankSlot();
        break;
      }
      case SHEET_INTENT.RESET: choices = clone(initial); cursor.row = 0; cursor.field = 0; break;
      case SHEET_INTENT.CONFIRM: return view().ok ? { done: "confirm", spec: spec_() } : { done: null, refused: view().problems };
      case SHEET_INTENT.CANCEL: return { done: "cancel" };
      default: break;
    }
    const fields = fieldsOf(rows()[cursor.row]);
    if (cursor.field >= fields.length) cursor.field = fields.length - 1;
    return { done: null };
  }

  /** Put the cursor on one row and field, for a screen that is tapped rather than stepped. */
  function select(row, field = 0) {
    const all = rows();
    if (!Number.isInteger(row) || row < 0 || row >= all.length) return;
    cursor.row = row;
    cursor.field = Math.max(0, Math.min(fieldsOf(all[row]).length - 1, Number.isInteger(field) ? field : 0));
  }

  /**
   * A tap on one field: it takes the cursor, and a choice (kind, form, minion role) steps to its
   * next value (kind: none, then each kind, then none again). A held slot's range or intensity
   * steps up by one and loops back to 1 past its limit (`fields[].limit`). A vital only takes the
   * cursor, for − and + to change.
   */
  function tap(row, field = 0) {
    select(row, field);
    if (cursor.row !== row) return;
    const target = rows()[row];
    const name = fieldsOf(target)[cursor.field];
    if (target.kind === "slot" && (name === "range" || name === "intensity")) {
      const slot = choices.slots[target.index];
      if (held(slot)) slot[name] = slot[name] + 1 > tapLimit(target.index, name) ? 1 : slot[name] + 1;
      return;
    }
    if (!NUMERIC_FIELDS.includes(name)) change(1);
  }

  /**
   * Set one slot field to a named value, for a screen that offers the choices as a list: `kind`
   * takes any of `SLOT_KIND_CHOICES` ("none" empties the slot), `expression` any expression.
   */
  function choose(row, field, value) {
    const target = rows()[row];
    if (target?.kind !== "slot") return;
    if (field === "kind" && SLOT_KIND_CHOICES.includes(value)) slotAt(target.index).kind = kindOf(value);
    else if (field === "expression" && AFFINITY_EXPRESSIONS.includes(value)) slotAt(target.index).expression = value;
  }

  /** The `--delver` spec for the character as it stands. */
  function spec_() {
    const kept = choices.slots.filter(held);
    const parts = ["count=1", `id=${id}`];
    if (kept.length > 0) {
      parts.push(`affinity=${kept[0].kind}`);
      parts.push(`affinities=${kept.map((slot) => `${slot.kind}:${slot.expression}:${slot.range}${slot.intensity > 1 ? `:${slot.intensity}` : ""}`).join(",")}`);
      parts.push(`equip=${kept.map((slot) => `${slot.kind}:${slot.expression}`).join(",")}`);
    }
    if (slotsBought() > PRESET_AFFINITY_SLOTS.delver) parts.push(`slots=${slotsBought()}`);
    parts.push("motivation=user_controlled");
    // The Configurator composes them as a retinue this delver leads; the Allocator prices them.
    if (choices.minions.length > 0) parts.push(`minions=${choices.minions.join("+")}`);
    parts.push(`vitals=${GAME_VITAL_KEYS.map((key) => `${key}:${choices.vitals[key].max}:${choices.vitals[key].regen}`).join(",")}`);
    return parts.join(";");
  }

  return { view, apply, select, tap, choose, spec: spec_, minions: () => [...choices.minions] };
}
