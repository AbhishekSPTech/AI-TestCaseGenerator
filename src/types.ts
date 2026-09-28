export type Category = "positive" | "negative" | "edge";

export interface Criterion {
  id: string; // AC1, AC2, ...
  text: string;
}

export interface TestStep {
  action: string;
  expected: string;
}

export interface TestCase {
  id?: string; // TC-001, assigned in code after generation
  title: string;
  category: Category;
  priority: 1 | 2 | 3 | 4;
  covers?: string[];
  preconditions?: string;
  test_data?: string;
  steps: TestStep[];
}

export interface TestSuite {
  summary: string;
  assumptions?: string[];
  open_questions?: string[];
  test_cases: TestCase[];
  warnings?: string[];
}

export interface Requirement {
  source: "azure" | "manual";
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  criteria: Criterion[]; // acceptanceCriteria split into AC1, AC2, ...
  areaPath?: string;
}
