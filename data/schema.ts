export type FeatureId =
  | 'hymenium.type'        // gills | false-ridges | pores | teeth | smooth | pits-ridges
  | 'gills.attachment'     // free | adnate | adnexed | decurrent
  | 'gills.edge'           // sharp | blunt-forking
  | 'spore.print'          // white | pink | brown | rust | black | olive
  | 'stem.base'            // volva | bulbous | equal | absent | lateral
  | 'stem.ring'            // present | absent
  | 'flesh.section'        // hollow-single | chambered-cottony | solid | zoned
  | 'bruising'             // none | blue | red | brown | latex
  | 'odor'                 // none | apricot | farinaceous | phenolic | anise
  | 'substrate'            // soil-mycorrhizal | hardwood-dead | hardwood-living | conifer | dung
  | 'growth.habit';        // solitary | scattered | clustered-fused | shelving

/** How the player obtains a feature value. Cost creates the game's tension. */
export interface Examination {
  feature: FeatureId;
  label: string;              // "Take a spore print"
  actionCost: number;         // 0 = free look, 3 = overnight spore print
  requiresTool?: 'knife' | 'paper' | 'loupe';
  destructive: boolean;       // teaches restraint / leave-no-trace
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

/** Controlled vocabulary. The validator rejects anything outside it. */
export const FEATURE_VALUES: Record<FeatureId, readonly string[]> = {
  'hymenium.type': ['gills', 'false-ridges', 'pores', 'teeth', 'smooth', 'pits-ridges'],
  'gills.attachment': ['free', 'adnate', 'adnexed', 'decurrent'],
  'gills.edge': ['sharp', 'blunt-forking'],
  'spore.print': ['white', 'pink', 'brown', 'rust', 'black', 'olive'],
  'stem.base': ['volva', 'bulbous', 'equal', 'absent', 'lateral'],
  'stem.ring': ['present', 'absent'],
  'flesh.section': ['hollow-single', 'chambered-cottony', 'solid', 'zoned'],
  'bruising': ['none', 'blue', 'red', 'brown', 'latex'],
  'odor': ['none', 'apricot', 'farinaceous', 'phenolic', 'anise'],
  'substrate': ['soil-mycorrhizal', 'hardwood-dead', 'hardwood-living', 'conifer', 'dung'],
  'growth.habit': ['solitary', 'scattered', 'clustered-fused', 'shelving'],
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

export const FORAGING_STATUSES = [
  'commonly-eaten-when-confirmed',
  'toxic',
  'deadly',
  'inedible',
  'not-recommended',
] as const;

export const SPECIMEN_AGES = ['button', 'young', 'mature', 'past-prime'] as const;
export type SpecimenAge = (typeof SPECIMEN_AGES)[number];
