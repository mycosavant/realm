export type FeatureId =
  | 'hymenium.type'        // gills | false-ridges | pores | teeth | smooth | pits-ridges
  | 'gills.attachment'     // free | adnate | adnexed | decurrent
  | 'gills.edge'           // sharp | blunt-forking
  | 'spore.print'          // white | cream | pale-yellow | pinkish-yellow | pink | brown | rust | black | olive
  | 'stem.base'            // volva | bulbous | equal | absent | lateral
  | 'stem.ring'            // present | absent
  | 'flesh.section'        // hollow-single | chambered-cottony | solid | zoned
  | 'bruising'             // none | blue | red | brown | latex
  | 'odor'                 // none | apricot | farinaceous | phenolic | anise
  | 'substrate'            // soil-mycorrhizal | hardwood-dead | hardwood-living | conifer | dung
  | 'growth.habit';        // solitary | scattered | clustered | clustered-fused | shelving

export type ToolId = 'knife' | 'paper' | 'loupe';

/**
 * Whether the player judges the value or the game states it.
 *
 * These are two different games and the difference is not cosmetic. `given`
 * hands over a value: there is no perceptual skill in noticing whether a stem
 * has a ring, and making someone squint at a picture of one teaches nothing.
 * `judged` hands over something to interpret and takes the player's reading,
 * which can be wrong — and being wrong, acting on it, and finding out at the
 * verdict is the thing an identification trainer is for.
 *
 * Reserve `judged` for characters the ratified sources themselves describe as
 * judgment calls. Kuo on pale spore prints: "perplexing." On the gills/ridges
 * distinction: "sort of a continuum... sometimes one must make a judgment
 * call." Those are the places the skill actually lives.
 *
 * Everything ships as `given` in v1 — see the note on EXAMINATIONS.
 */
export type ReadingMode = 'given' | 'judged';

/** How the player obtains a feature value. Cost creates the game's tension. */
export interface Examination {
  feature: FeatureId;
  label: string;              // "Take a spore print"
  actionCost: number;         // 0 = free look, 3 = overnight spore print
  requiresTool?: ToolId;
  destructive: boolean;       // teaches restraint / leave-no-trace
  /** Cost and perceptual difficulty are orthogonal: `hymenium.type` is free. */
  reading: ReadingMode;
}

export interface Species {
  id: string;
  scientificName: string;
  commonNames: string[];
  gbifTaxonKey?: number;
  inatTaxonId?: number;       // used ONLY to deep-link outward

  /** Ground-truth features. Values may be arrays where the taxon varies. */
  features: Partial<Record<FeatureId, string[]>>;

  /** Deliberately not `edible: boolean`. The game never renders a verdict. */
  foragingStatus:
    | 'commonly-eaten-when-confirmed'
    | 'toxic'
    | 'deadly'
    | 'inedible'
    | 'not-recommended';

  toxinNotes?: string;        // shown for toxic/deadly; onset, mechanism
  ecologyNotes: string;
  phenology: { startMonth: number; endMonth: number };

  /** CI fails if this is missing. Review is structural, not aspirational. */
  review: { reviewedBy: string | null; reviewedOn: string | null; sources: string[] };
}

/** The actual curriculum unit. */
export interface ConfusionSet {
  id: string;
  memberSpeciesIds: string[];
  /** Features that genuinely separate the members. Ground truth for grading. */
  discriminators: FeatureId[];
  /** Features that look decisive but aren't — the trap. */
  redHerrings: FeatureId[];
  teachingNote: string;
}

/**
 * One species' share of a foray, and how often it lies about its substrate.
 *
 * Weights are relative and need not sum to anything. They are a curriculum
 * decision, not an abundance estimate: if the toxic member of a set is rare in
 * the patch, the player learns "probably the edible one" as a prior, which is
 * the exact reflex this app exists to break.
 */
export interface ForaySpeciesWeight {
  speciesId: string;
  weight: number;
}

/**
 * An individual that presents a substrate other than its own.
 *
 * The only trap the generator supports, because it is the only one that is
 * honest: the specimen really does rise from bare ground, the player really
 * does read it correctly, and the evidence is genuinely misleading. That is a
 * different lesson from misperception, and the value the individual presents
 * has to be one another member of the set actually carries — otherwise it
 * counterfeits nobody and teaches nothing.
 *
 * The rate lives here and not in the species file on purpose. `chance: 0.35`
 * inside `omphalotus-illudens.json` would put a game number into a document
 * whose reviewer is checking it against MushroomExpert. Different document,
 * different reviewer.
 */
export interface ForayTrap {
  speciesId: string;
  /** Substrate this individual presents instead of its own. */
  presentsSubstrate: string;
  /** 0..1 — the share of this species' individuals that present it. */
  chance: number;
  /** Author-facing: why this trap is realistic, and where the number came from. */
  designNote: string;
}

/**
 * A patch of ground on a particular month — the unit a player actually plays.
 *
 * Everything tunable is here rather than in a scene component, because a spawn
 * table hardcoded in a renderer is the content-as-data bug. The mechanism lives
 * in `src/game/forage.ts` and is pure, so a seed reproduces a forest exactly.
 *
 * `month` gates which members fruit, and the curriculum is genuinely seasonal:
 * in the shipped set the three taxa overlap in August alone. A foray may cover
 * fewer members than its confusion set — but only because nature left them out,
 * never because the author did. The validator holds that line.
 */
export interface Foray {
  id: string;
  confusionSetId: string;
  /** Player-facing short name. */
  title: string;
  /** 1..12. */
  month: number;
  specimenCount: number;
  speciesWeights: ForaySpeciesWeight[];
  traps: ForayTrap[];
  /** Author-facing: why this month, these weights, this trap rate. */
  designNote: string;
}

/**
 * Does a taxon with this phenology fruit in this month?
 *
 * A window may wrap the new year — velvet shank runs November into March — so
 * `startMonth > endMonth` is a wrap, not a mistake.
 */
export function fruitsInMonth(phenology: Species['phenology'], month: number): boolean {
  const { startMonth, endMonth } = phenology;
  return startMonth <= endMonth
    ? month >= startMonth && month <= endMonth
    : month >= startMonth || month <= endMonth;
}

/** An individual in the world. You ID individuals, not species. */
export interface Specimen {
  id: string;
  speciesId: string;
  age: 'button' | 'young' | 'mature' | 'past-prime';
  weathering: number;                              // 0..1
  /** Features destroyed or never developed on THIS individual. */
  unavailableFeatures: FeatureId[];
  /**
   * The realised ground truth for THIS individual: one concrete value per
   * feature the species defines. Not "what the player has seen so far" — the
   * player's progress lives in `IdAttempt.featuresChecked`. A feature listed in
   * `unavailableFeatures` may still have a value here; the player just cannot
   * reach it.
   */
  observedFeatures: Partial<Record<FeatureId, string>>;
  substrateOverride?: string;
}

export interface IdAttempt {
  specimenId: string;
  featuresChecked: FeatureId[];
  answer: { kind: 'species'; speciesId: string } | { kind: 'declined' };
}

export interface Grade {
  correct: boolean;
  /** Fraction of the confusion set's discriminators the player actually checked. */
  evidenceRatio: number;
  /** True when declining was the right call and the player declined. */
  correctlyDeclined: boolean;
  xp: number;
  feedback: string[];

  // --- additive, so the UI does not have to re-derive any of this ---
  /** The specimen's reachable evidence cannot single out one member of the set. */
  underdetermined: boolean;
  /** Members still standing after every *reachable* discriminator is applied. */
  candidateSpeciesIds: string[];
  /** Discriminators the player never looked at. */
  missedDiscriminators: FeatureId[];
  /**
   * Set when a wrong answer would have been a real-world catastrophe. The run
   * stops and the toxin note is shown. Never a verdict about edibility — only
   * ever a warning about a mistake already made in-game.
   */
  hardStop?: { speciesId: string; message: string };
}

export const FEATURE_IDS = [
  'hymenium.type',
  'gills.attachment',
  'gills.edge',
  'spore.print',
  'stem.base',
  'stem.ring',
  'flesh.section',
  'bruising',
  'odor',
  'substrate',
  'growth.habit',
] as const satisfies readonly FeatureId[];

/**
 * Controlled vocabulary. The validator rejects anything outside it.
 *
 * The vocabulary exists to be extended. If a ratified source describes a
 * character this list cannot express, add the value — do not round the source
 * to the nearest thing already here. A coarsened value reads as a fact and is
 * not one.
 */
export const FEATURE_VALUES: Record<FeatureId, readonly string[]> = {
  'hymenium.type': ['gills', 'false-ridges', 'pores', 'teeth', 'smooth', 'pits-ridges'],
  'gills.attachment': ['free', 'adnate', 'adnexed', 'decurrent'],
  'gills.edge': ['sharp', 'blunt-forking'],
  // The pale end of this list is deliberately fine-grained. Three taxa in the
  // first confusion set are described across exactly that range, and the
  // difference between 'pinkish-yellow' and 'white'/'cream' is readable in the
  // field — on dark paper, which is why the spore print examination calls for
  // it. Coarsening any of these to 'white' would erase a real character.
  'spore.print': [
    'white',
    'cream',
    'pale-yellow',
    'pinkish-yellow',
    'pink',
    'brown',
    'rust',
    'black',
    'olive',
  ],
  'stem.base': ['volva', 'bulbous', 'equal', 'absent', 'lateral'],
  'stem.ring': ['present', 'absent'],
  'flesh.section': ['hollow-single', 'chambered-cottony', 'solid', 'zoned'],
  'bruising': ['none', 'blue', 'red', 'brown', 'latex'],
  'odor': ['none', 'apricot', 'farinaceous', 'phenolic', 'anise'],
  'substrate': ['soil-mycorrhizal', 'hardwood-dead', 'hardwood-living', 'conifer', 'dung'],
  // 'clustered' is separate from 'clustered-fused': clustering on its own is
  // suggestive, fused stem bases are a structural claim. Do not assert the
  // second when a source only supports the first.
  'growth.habit': ['solitary', 'scattered', 'clustered', 'clustered-fused', 'shelving'],
};

/** Human-readable names, used in scoring feedback and the notebook. */
export const FEATURE_LABELS: Record<FeatureId, string> = {
  'hymenium.type': 'spore-bearing surface',
  'gills.attachment': 'gill attachment',
  'gills.edge': 'gill edge',
  'spore.print': 'spore print',
  'stem.base': 'stem base',
  'stem.ring': 'ring on stem',
  'flesh.section': 'flesh in cross-section',
  'bruising': 'bruising reaction',
  'odor': 'odor',
  'substrate': 'substrate',
  'growth.habit': 'growth habit',
};

/**
 * Human-readable names for the *values*, not the features.
 *
 * Without this table an interface renders `soil-mycorrhizal` and
 * `blunt-forking` raw at a beginner, possibly a child. Every value in
 * `FEATURE_VALUES` needs an entry — a missing one is a raw identifier on
 * screen, so `tests/content.test.ts` checks coverage both ways.
 *
 * These are written as what a person standing over the mushroom would see, not
 * as what the character means. `soil-mycorrhizal` is the sharpest case: the id
 * names an inference about the fungus's biology that nobody can observe, while
 * the label names the observable — and the observable is exactly what the
 * buried-root trap counterfeits. That mismatch is a known vocabulary problem,
 * recorded in docs/v1-interface-design.md; the label must not repeat it.
 */
export const VALUE_LABELS: Record<FeatureId, Record<string, string>> = {
  // The character the first confusion set turns on.
  'hymenium.type': {
    gills: 'thin, blade-like gills',
    'false-ridges': 'false gills: blunt, forking ridges',
    pores: 'a spongy layer of pores',
    teeth: 'hanging teeth or spines',
    smooth: 'smooth, or with shallow wrinkles',
    'pits-ridges': 'a pitted, honeycombed surface',
  },
  'gills.attachment': {
    free: 'not reaching the stem',
    adnate: 'broadly attached to the stem',
    adnexed: 'narrowly attached to the stem',
    decurrent: 'running down the stem',
  },
  'gills.edge': {
    sharp: 'a sharp, thin edge',
    'blunt-forking': 'a blunt edge that forks',
  },
  // The pale end is fine-grained on purpose. These four are told apart on dark
  // paper and barely at all on white.
  'spore.print': {
    white: 'white',
    cream: 'cream',
    'pale-yellow': 'pale yellow',
    'pinkish-yellow': 'pale pinkish yellow',
    pink: 'pink',
    brown: 'brown',
    rust: 'rust brown',
    black: 'black',
    olive: 'olive',
  },
  'stem.base': {
    volva: 'a cup or sac around the very base',
    bulbous: 'a swollen, bulb-like base',
    equal: 'the same width all the way down',
    absent: 'no stem at all',
    lateral: 'a stem set off to one side',
  },
  'stem.ring': {
    present: 'a ring on the stem',
    absent: 'no ring',
  },
  'flesh.section': {
    'hollow-single': 'hollow, one single chamber',
    'chambered-cottony': 'stuffed with cottony chambers',
    solid: 'solid all through',
    zoned: 'banded in layers',
  },
  // Slow reactions are the norm here, not the exception — see the examination
  // label, which tells the player to bruise it and wait.
  bruising: {
    none: 'no colour change',
    blue: 'bruises blue',
    red: 'bruises red',
    brown: 'bruises brown',
    latex: 'bleeds a milky latex',
  },
  odor: {
    none: 'no distinct smell',
    apricot: 'sweet, like apricots',
    farinaceous: 'like fresh meal or cut cucumber',
    phenolic: 'chemical, like ink or disinfectant',
    anise: 'sweet, like aniseed',
  },
  substrate: {
    'soil-mycorrhizal': 'from soil, not from wood',
    'hardwood-dead': 'on dead hardwood — a stump, a log, or a buried root',
    'hardwood-living': 'on a living hardwood tree',
    conifer: 'on conifer wood',
    dung: 'on dung',
  },
  'growth.habit': {
    solitary: 'growing singly',
    scattered: 'scattered, not touching',
    clustered: 'in clusters',
    'clustered-fused': 'in clusters, stem bases fused together',
    shelving: 'in overlapping shelves',
  },
};

/**
 * The table is keyed by feature and not flat, because the same value means
 * different things under different characters and a flat map would silently
 * pick one. `none` is "no colour change" for `bruising` and "no distinct smell"
 * for `odor`; `absent` is "no stem at all" for `stem.base` and "no ring" for
 * `stem.ring`; `brown` is a spore print colour and also a bruising reaction.
 */
export function valueLabel(feature: FeatureId, value: string): string {
  return VALUE_LABELS[feature]?.[value] ?? value;
}

export const FORAGING_STATUSES = [
  'commonly-eaten-when-confirmed',
  'toxic',
  'deadly',
  'inedible',
  'not-recommended',
] as const;

export const SPECIMEN_AGES = ['button', 'young', 'mature', 'past-prime'] as const;
export type SpecimenAge = (typeof SPECIMEN_AGES)[number];
