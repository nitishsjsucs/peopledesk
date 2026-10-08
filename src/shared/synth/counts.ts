// Single source of truth for every count the resume and the README quote. Tests assert the generated
// corpus, org, seeded D1 and eval dataset against these numbers.

export const EXPECTED_COUNTS = {
  // Policy corpus
  policyCategories: 10,
  policyDocuments: 100,
  docsPerCategory: 10,
  audienceSplit: { all: 70, managers: 20, hr: 10 },
  audienceSplitPerCategory: { all: 7, managers: 2, hr: 1 },
  docsByVersionCount: { 1: 55, 2: 35, 3: 10 },
  policyVersions: 155,
  currentVersions: 100,
  scheduledVersions: 8,
  scheduledTwoVersionDocs: 6,
  scheduledThreeVersionDocs: 2,
  supersededVersions: 47,
  r2Objects: 155,
  factArchetypes: 9,
  ambiguityGroups: 6,
  sectionsPerVersion: 6,

  // Organization
  employees: 120,
  roles: { employee: 100, manager: 15, hr_admin: 5 },
  regions: { US: 60, IN: 40, UK: 20 },
  departments: 6,
  onboardingPlans: 30,
  onboardingTasks: 360,
  tasksPerPlan: 12,
  orientationSessions: 24,
  sessionsPerWeek: 3,
  seededBookings: 18,
  fullSessions: 2,
  unbookedNewHires: 12,
  seededTickets: 150,
  personas: 6,

  // MCP and evals
  mcpTools: 6,
  evalCases: 200,
  evalByCategory: {
    policy_answerable: 70,
    outdated_document: 25,
    ambiguous: 20,
    unauthorized: 30,
    action_request: 55,
  },
} as const;

/** Business date the committed default dataset is generated for. */
export const DEFAULT_AS_OF = "2026-10-01";
